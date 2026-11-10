import type { UserId } from "@/lib/api/types";
import { applyAudioOutput } from "./playback";
import { RemoteVoiceMixer } from "./remoteMixer";
import type { PlaybackProfileId, PlaybackTuning, VoiceSettings } from "./settings";
import type { SpeechDetector } from "./vad";
import type { Peer, RemoteVoice } from "./webrtcPeer";
import type { AudioRole } from "./webrtcRemoteMedia";

export interface RemoteAudioEnv {
  readonly peers: ReadonlyMap<UserId, Peer>;
  /** Draws the speaking ring for remote voices; this module only feeds it. */
  readonly speech: SpeechDetector;
  settings(): VoiceSettings;
  /** The chosen output device failed and the system route took over. */
  forgetOutputDevice(): void;
  /** What a peer publishes to the UI has changed. */
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
 * `peer.media`; `route` puts every stream where that says it belongs and can
 * run after any event.
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

  /** A remote audio track arrived. Only files it; `route` decides where it plays. */
  receive(peer: Peer, stream: MediaStream, track: MediaStreamTrack): void {
    peer.media.addAudio(stream);
    track.onended = () => this.ended(peer, stream.id);
    this.route(peer);
  }

  /**
   * Put the newest stream of each kind on its sinks, and only there.
   *
   * Idempotent, so it can run after any event: a stream that turned out to be
   * a screen share's sound is taken off the voice sink before it is attached
   * to the screen's.
   */
  route(peer: Peer): void {
    // No short-circuit: both kinds must be settled.
    const voiceMoved = this.reconcile(peer, "microphone");
    const screenMoved = this.reconcile(peer, "screen");
    if (voiceMoved || screenMoved) this.env.changed();
  }

  /** Free a dropped peer's sinks and strips. */
  release(peer: Peer): void {
    this.env.speech.remove(peer.userId);
    this.mixer.remove(peer.userId);
    this.screenMixer.remove(peer.userId);
    for (const sinks of voicesOf(peer)) discard(sinks);
  }

  setDeafened(deafened: boolean): void {
    if (this.deafened === deafened) return;
    this.deafened = deafened;
    for (const peer of this.env.peers.values()) {
      for (const sinks of voicesOf(peer)) sinks.audio.muted = deafened;
    }
  }

  applyVolume(peer: Peer): void {
    for (const role of ROLES) {
      const sinks = this.sinksOf(peer, role);
      if (!sinks) continue;
      if (sinks.processed) this.mixerOf(role).setVolume(peer.userId, peer.playbackVolume);
      else this.applyRawVolume(peer, role);
    }
  }

  /**
   * Only a Web Audio strip can be gated or denoised; a raw `<audio>` fallback
   * has no graph to put either into, so the flag waits for the next attach.
   * Both are for voices: shared sound is never gated or denoised.
   */
  applyGate(peer: Peer): void {
    if (!peer.voice.processed) return;
    this.mixer.setGate(peer.userId, peer.gated).catch(() => undefined);
  }

  applySuppression(peer: Peer): void {
    if (!peer.voice.processed) return;
    this.mixer.setSuppressor(peer.userId, peer.suppressed).catch(() => undefined);
  }

  setProfile(profile: PlaybackProfileId, tuning: PlaybackTuning): void {
    this.mixer.setProfile(profile, tuning);
  }

  /** Move every audible sink to the chosen output device and volume. */
  async refreshOutput(): Promise<void> {
    const peers = [...this.env.peers.values()];
    const sinks = peers.flatMap(voicesOf);
    const failures = await Promise.all(sinks.map((sink) => this.applyOutput(sink.audio)));
    if (failures.some(Boolean)) this.env.forgetOutputDevice();
    for (const peer of peers) {
      for (const role of ROLES) {
        if (this.sinksOf(peer, role)?.processed === false) this.applyRawVolume(peer, role);
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

  /** Make the sinks of one kind play what `peer.media` says they should. */
  private reconcile(peer: Peer, role: AudioRole): boolean {
    const wanted = peer.media.newestAudio(role);
    const playing = this.sinksOf(peer, role)?.streamId ?? null;
    if ((wanted?.id ?? null) === playing) return false;

    if (wanted) this.attach(peer, role, wanted);
    else this.detach(peer, role);
    return true;
  }

  private attach(peer: Peer, role: AudioRole, stream: MediaStream): void {
    const microphone = role === "microphone";
    const sinks = microphone ? peer.voice : (peer.screenAudio ??= this.createVoice());
    if (microphone) peer.speaking = false;

    sinks.audio.muted = this.deafened;
    attachStream(sinks.decoder, stream);
    sinks.processed = this.mixerOf(role).attach(
      peer.userId,
      stream,
      sinks.audio,
      peer.playbackVolume,
      microphone ? { gated: peer.gated, suppressed: peer.suppressed } : undefined,
    );
    if (!sinks.processed) this.playRaw(peer, role, stream);
    sinks.streamId = stream.id;
    void this.ensurePlayback(peer, role, stream);
    if (microphone) void this.env.speech.add(peer.userId, stream);
  }

  /** Nothing of this kind is left to play. A voice keeps its sinks; a share's go. */
  private detach(peer: Peer, role: AudioRole): void {
    this.mixerOf(role).remove(peer.userId);
    if (role === "screen") {
      if (peer.screenAudio) discard(peer.screenAudio);
      peer.screenAudio = null;
      return;
    }

    this.env.speech.remove(peer.userId);
    const { voice } = peer;
    voice.audio.srcObject = null;
    voice.decoder.srcObject = null;
    voice.processed = false;
    voice.streamId = null;
    peer.speaking = false;
    peer.level = 0;
  }

  private ended(peer: Peer, streamId: string): void {
    if (this.env.peers.get(peer.userId) !== peer) return;
    if (!peer.media.removeAudio(streamId)) return;

    // Another stream may be waiting to take over.
    this.route(peer);
    this.env.changed();
  }

  /**
   * Verify that the processed graph really started. A rejected resume or play
   * leaves both the sound and the speaking ring silent, so the raw stream is
   * the last resort on strict browsers.
   */
  private async ensurePlayback(peer: Peer, role: AudioRole, stream: MediaStream): Promise<void> {
    // Whether the stream started out on the mixer, even if the resume check
    // below moves it to the raw sink: a play() rejection after that move still
    // gets one more attempt on the raw sink.
    const processed = this.sinksOf(peer, role)?.processed ?? false;
    if (processed && !(await this.mixerOf(role).resume()) && !this.useRaw(peer, role, stream)) {
      return;
    }

    try {
      await this.sinksOf(peer, role)?.audio.play();
      return;
    } catch {
      if (!processed || !this.useRaw(peer, role, stream)) return;
    }
    // The document-level gesture hook retries this exact element on the next
    // click or key press, without making the person leave the call.
    await this.sinksOf(peer, role)?.audio.play().catch(() => undefined);
  }

  /** Switch to the raw stream, unless the peer or its stream moved on meanwhile. */
  private useRaw(peer: Peer, role: AudioRole, stream: MediaStream): boolean {
    if (
      this.env.peers.get(peer.userId) !== peer ||
      this.sinksOf(peer, role)?.streamId !== stream.id ||
      !peer.media.hasAudio(stream.id)
    ) {
      return false;
    }
    this.playRaw(peer, role, stream);
    return true;
  }

  private playRaw(peer: Peer, role: AudioRole, stream: MediaStream): void {
    const sinks = this.sinksOf(peer, role);
    if (!sinks) return;
    this.mixerOf(role).remove(peer.userId);
    sinks.processed = false;
    sinks.decoder.srcObject = null;
    sinks.audio.srcObject = stream;
    this.applyRawVolume(peer, role);
  }

  private applyRawVolume(peer: Peer, role: AudioRole): void {
    const sinks = this.sinksOf(peer, role);
    if (!sinks) return;
    const global = this.env.settings().outputVolume / 100;
    const participant = peer.playbackVolume / 100;
    sinks.audio.volume = Math.min(1, Math.max(0, global * participant));
  }

  private sinksOf(peer: Peer, role: AudioRole): RemoteVoice | null {
    return role === "microphone" ? peer.voice : peer.screenAudio;
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
    for (const peer of this.env.peers.values()) {
      for (const { audio, decoder } of voicesOf(peer)) {
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

/** The sinks a peer has right now: always the voice, the share's sound when there is one. */
function voicesOf(peer: Peer): RemoteVoice[] {
  return peer.screenAudio ? [peer.voice, peer.screenAudio] : [peer.voice];
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
