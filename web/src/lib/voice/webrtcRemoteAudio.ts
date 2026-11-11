import type { UserId } from "@/lib/api/types";
import { applyAudioOutput } from "./playback";
import { RemoteVoiceMixer } from "./remoteMixer";
import type { PlaybackProfileId, PlaybackTuning, VoiceSettings } from "./settings";
import type { SpeechDetector } from "./vad";
import type { Participant, RemoteVoice } from "./webrtcParticipant";
import type { AudioRole } from "./webrtcRemoteMedia";

export interface RemoteAudioEnv {
  readonly people: ReadonlyMap<UserId, Participant>;
  /** Draws the speaking ring for remote voices; this module only feeds it. */
  readonly speech: SpeechDetector;
  settings(): VoiceSettings;
  /** The chosen output device failed and the system route took over. */
  forgetOutputDevice(): void;
  /** What a person publishes to the UI has changed. */
  changed(): void;
}

const ROLES: readonly AudioRole[] = ["microphone", "screen"];

/**
 * Everything the other people sound like on this machine: the hidden audio
 * elements, the mixers that process each voice, and deafening.
 *
 * A person can send two kinds of sound, their microphone and the sound of
 * their shared screen, and each gets sinks of its own so that no stream is ever
 * played through two elements. Which stream is which is decided by
 * `person.media`; `route` puts every stream where that says it belongs and can
 * run after any event. None of it depends on the connection the sound came on.
 *
 * Each source gets two elements. The audible one carries the mixer's output, or
 * the raw stream when Web Audio is unavailable. The muted one is attached to
 * the raw stream alone: Chromium and Brave may discard every RTP sample when
 * Web Audio is the only consumer of a remote track, and a muted direct element
 * keeps the jitter buffer decoding without playing the sound twice.
 */
export class RemoteAudio {
  private readonly mixer: RemoteVoiceMixer;
  /** Unity gain and no voice processing: shared sound is content, not speech. */
  private readonly screenMixer = new RemoteVoiceMixer("off", undefined, 1);
  private host: HTMLElement | null = null;
  private deafened = false;

  constructor(private readonly env: RemoteAudioEnv) {
    const { playbackProfile, playbackTuning } = env.settings();
    this.mixer = new RemoteVoiceMixer(playbackProfile, playbackTuning);
  }

  /** Sinks for a new source. The audible one is created first. */
  createVoice(): RemoteVoice {
    const audio = this.createSink();
    audio.muted = this.deafened;
    void this.applyOutput(audio).then((chosenDeviceFailed) => {
      if (chosenDeviceFailed) this.env.forgetOutputDevice();
    });

    const decoder = this.createSink();
    decoder.muted = true;
    return { audio, decoder, processed: false, streamId: null };
  }

  /**
   * A remote audio track arrived. Only files it, under `id` (the stream's own
   * unless a directory names another); `route` decides where it plays.
   */
  receive(
    person: Participant,
    stream: MediaStream,
    track: MediaStreamTrack,
    id: string = stream.id,
  ): void {
    person.media.addAudio(stream, id);
    track.onended = () => this.ended(person, id);
    this.route(person);
  }

  /**
   * Stop playing what `person` sent under `id`. A track that a media server
   * stops forwarding goes quiet without ever ending, so whoever knows it is
   * gone says so here.
   */
  withdraw(person: Participant, id: string): void {
    if (!person.media.removeAudio(id)) return;

    // Another stream may be waiting to take over.
    this.route(person);
    this.env.changed();
  }

  /**
   * Put the newest stream of each kind on its sinks, and only there.
   *
   * Idempotent, so it can run after any event: a stream that turned out to be
   * a screen share's sound is taken off the voice sink before it is attached
   * to the screen's.
   */
  route(person: Participant): void {
    // No short-circuit: both kinds must be settled.
    const voiceMoved = this.reconcile(person, "microphone");
    const screenMoved = this.reconcile(person, "screen");
    if (voiceMoved || screenMoved) this.env.changed();
  }

  /** Free a dropped person's sinks and strips. */
  release(person: Participant): void {
    this.env.speech.remove(person.userId);
    this.mixer.remove(person.userId);
    this.screenMixer.remove(person.userId);
    for (const sinks of voicesOf(person)) discard(sinks);
  }

  setDeafened(deafened: boolean): void {
    if (this.deafened === deafened) return;
    this.deafened = deafened;
    for (const person of this.env.people.values()) {
      for (const sinks of voicesOf(person)) sinks.audio.muted = deafened;
    }
  }

  applyVolume(person: Participant): void {
    for (const role of ROLES) {
      const sinks = this.sinksOf(person, role);
      if (!sinks) continue;
      if (sinks.processed) this.mixerOf(role).setVolume(person.userId, person.playbackVolume);
      else this.applyRawVolume(person, role);
    }
  }

  /**
   * Only a Web Audio strip can be gated or denoised; a raw `<audio>` fallback
   * has no graph to put either into, so the flag waits for the next attach.
   * Both are for voices: shared sound is never gated or denoised.
   */
  applyGate(person: Participant): void {
    if (!person.voice.processed) return;
    this.mixer.setGate(person.userId, person.gated).catch(() => undefined);
  }

  applySuppression(person: Participant): void {
    if (!person.voice.processed) return;
    this.mixer.setSuppressor(person.userId, person.suppressed).catch(() => undefined);
  }

  setProfile(profile: PlaybackProfileId, tuning: PlaybackTuning): void {
    this.mixer.setProfile(profile, tuning);
  }

  /** Move every audible sink to the chosen output device and volume. */
  async refreshOutput(): Promise<void> {
    const people = [...this.env.people.values()];
    const sinks = people.flatMap(voicesOf);
    const failures = await Promise.all(sinks.map((sink) => this.applyOutput(sink.audio)));
    if (failures.some(Boolean)) this.env.forgetOutputDevice();
    for (const person of people) {
      for (const role of ROLES) {
        if (this.sinksOf(person, role)?.processed === false) this.applyRawVolume(person, role);
      }
    }
  }

  /** Synchronous by design: callers invoke it from an active user gesture. */
  prepare(): void {
    this.mixer.prepare();
    this.screenMixer.prepare();
    this.playAll();
  }

  /** Bring playback back after the tab was backgrounded. */
  async resume(): Promise<void> {
    await this.mixer.resume();
    await this.screenMixer.resume();
    this.playAll();
  }

  /** Drop the hidden container once the call is over. */
  removeHost(): void {
    this.host?.remove();
    this.host = null;
  }

  dispose(): void {
    this.mixer.dispose();
    this.screenMixer.dispose();
    this.removeHost();
  }

  /** Make the sinks of one kind play what `person.media` says they should. */
  private reconcile(person: Participant, role: AudioRole): boolean {
    const wanted = person.media.newestAudio(role);
    const playing = this.sinksOf(person, role)?.streamId ?? null;
    if ((wanted?.id ?? null) === playing) return false;

    if (wanted) this.attach(person, role, wanted);
    else this.detach(person, role);
    return true;
  }

  private attach(person: Participant, role: AudioRole, stream: MediaStream): void {
    const microphone = role === "microphone";
    const sinks = microphone ? person.voice : (person.screenAudio ??= this.createVoice());
    if (microphone) person.speaking = false;

    sinks.audio.muted = this.deafened;
    attachStream(sinks.decoder, stream);
    sinks.processed = this.mixerOf(role).attach(
      person.userId,
      stream,
      sinks.audio,
      person.playbackVolume,
      microphone ? { gated: person.gated, suppressed: person.suppressed } : undefined,
    );
    if (!sinks.processed) this.playRaw(person, role, stream);
    sinks.streamId = stream.id;
    void this.ensurePlayback(person, role, stream);
    if (microphone) void this.env.speech.add(person.userId, stream);
  }

  /** Nothing of this kind is left to play. A voice keeps its sinks; a share's go. */
  private detach(person: Participant, role: AudioRole): void {
    this.mixerOf(role).remove(person.userId);
    if (role === "screen") {
      if (person.screenAudio) discard(person.screenAudio);
      person.screenAudio = null;
      return;
    }

    this.env.speech.remove(person.userId);
    const { voice } = person;
    voice.audio.srcObject = null;
    voice.decoder.srcObject = null;
    voice.processed = false;
    voice.streamId = null;
    person.speaking = false;
    person.level = 0;
  }

  private ended(person: Participant, streamId: string): void {
    if (this.env.people.get(person.userId) !== person) return;
    this.withdraw(person, streamId);
  }

  /**
   * Verify that the processed graph really started. A rejected resume or play
   * leaves both the sound and the speaking ring silent, so the raw stream is
   * the last resort on strict browsers.
   */
  private async ensurePlayback(
    person: Participant,
    role: AudioRole,
    stream: MediaStream,
  ): Promise<void> {
    // Whether the stream started out on the mixer, even if the resume check
    // below moves it to the raw sink: a play() rejection after that move still
    // gets one more attempt on the raw sink.
    const processed = this.sinksOf(person, role)?.processed ?? false;
    if (processed && !(await this.mixerOf(role).resume()) && !this.useRaw(person, role, stream)) {
      return;
    }

    try {
      await this.sinksOf(person, role)?.audio.play();
      return;
    } catch {
      if (!processed || !this.useRaw(person, role, stream)) return;
    }
    // The document-level gesture hook retries this exact element on the next
    // click or key press, without making the person leave the call.
    await this.sinksOf(person, role)?.audio.play().catch(() => undefined);
  }

  /** Switch to the raw stream, unless the person or their stream moved on meanwhile. */
  private useRaw(person: Participant, role: AudioRole, stream: MediaStream): boolean {
    if (
      this.env.people.get(person.userId) !== person ||
      this.sinksOf(person, role)?.streamId !== stream.id ||
      !person.media.holdsAudio(stream)
    ) {
      return false;
    }
    this.playRaw(person, role, stream);
    return true;
  }

  private playRaw(person: Participant, role: AudioRole, stream: MediaStream): void {
    const sinks = this.sinksOf(person, role);
    if (!sinks) return;
    this.mixerOf(role).remove(person.userId);
    sinks.processed = false;
    sinks.decoder.srcObject = null;
    sinks.audio.srcObject = stream;
    this.applyRawVolume(person, role);
  }

  private applyRawVolume(person: Participant, role: AudioRole): void {
    const sinks = this.sinksOf(person, role);
    if (!sinks) return;
    const global = this.env.settings().outputVolume / 100;
    const participant = person.playbackVolume / 100;
    sinks.audio.volume = Math.min(1, Math.max(0, global * participant));
  }

  private sinksOf(person: Participant, role: AudioRole): RemoteVoice | null {
    return role === "microphone" ? person.voice : person.screenAudio;
  }

  private mixerOf(role: AudioRole): RemoteVoiceMixer {
    return role === "microphone" ? this.mixer : this.screenMixer;
  }

  /** Resolves true when the chosen output device failed and the system route took over. */
  private async applyOutput(sink: HTMLAudioElement): Promise<boolean> {
    const settings = this.env.settings();
    try {
      await applyAudioOutput(sink, settings);
      return false;
    } catch {
      // Restore the system route explicitly: swallowing setSinkId's rejection
      // can leave Chromium pinned to the device that just went away.
      await applyAudioOutput(sink, {
        outputDeviceId: null,
        outputVolume: settings.outputVolume,
      }).catch(() => undefined);
      return settings.outputDeviceId !== null;
    }
  }

  private playAll(): void {
    for (const person of this.env.people.values()) {
      for (const { audio, decoder } of voicesOf(person)) {
        decoder.play().catch(() => undefined);
        audio.play().catch(() => undefined);
      }
    }
  }

  private createSink(): HTMLAudioElement {
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    // Playback belongs to the page, not to a visible control.
    audio.setAttribute("aria-hidden", "true");
    this.ensureHost().appendChild(audio);
    return audio;
  }

  private ensureHost(): HTMLElement {
    if (this.host) return this.host;
    const host = document.createElement("div");
    host.dataset["stellarrVoiceAudio"] = "";
    // Keep media elements in the rendering tree. Some Chromium builds suspend
    // playback for descendants of `display:none`, even when `play()` resolved.
    Object.assign(host.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      overflow: "hidden",
      pointerEvents: "none",
    });
    document.body.appendChild(host);
    this.host = host;
    return host;
  }
}

/** The sinks a person has right now: always the voice, the share's sound when there is one. */
function voicesOf(person: Participant): RemoteVoice[] {
  return person.screenAudio ? [person.voice, person.screenAudio] : [person.voice];
}

function discard(sinks: RemoteVoice): void {
  for (const element of [sinks.audio, sinks.decoder]) {
    element.srcObject = null;
    element.remove();
  }
}

function attachStream(element: HTMLMediaElement, stream: MediaStream): void {
  element.srcObject = stream;
  // Autoplay policies can defer playback until the next interaction; the
  // lifecycle watcher and the gesture hook retry when the tab comes forward.
  element.play().catch(() => undefined);
}
