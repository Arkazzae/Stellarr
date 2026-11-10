import type { UserId } from "@/lib/api/types";
import { applyAudioOutput } from "./playback";
import { RemoteVoiceMixer } from "./remoteMixer";
import type { PlaybackProfileId, PlaybackTuning, VoiceSettings } from "./settings";
import type { SpeechDetector } from "./vad";
import type { Peer, RemoteVoice } from "./webrtcPeer";

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

type RemoteAudioRole = "microphone";

/**
 * What a remote audio stream is. Today every one is somebody's microphone;
 * this is the single place that decides, so another kind of stream can be told
 * apart here without touching the routing below.
 */
function classify(_peer: Peer, _streamId: string): RemoteAudioRole {
  return "microphone";
}

/**
 * Everything the other people sound like on this machine: the hidden audio
 * elements, the mixer that processes each voice, and deafening.
 *
 * Each voice gets two elements. The audible one carries the mixer's output, or
 * the raw stream when Web Audio is unavailable. The muted one is attached to
 * the raw stream alone: Chromium and Brave may discard every RTP sample when
 * Web Audio is the only consumer of a remote track, and a muted direct element
 * keeps the jitter buffer decoding without playing the voice twice.
 */
export class RemoteAudio {
  private readonly mixer: RemoteVoiceMixer;
  private host: HTMLElement | null = null;
  private deafened = false;

  constructor(private readonly env: RemoteAudioEnv) {
    const { playbackProfile, playbackTuning } = env.settings();
    this.mixer = new RemoteVoiceMixer(playbackProfile, playbackTuning);
  }

  /** Sinks for a new peer. The audible one is created first. */
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
    peer.audioStreams.set(stream.id, stream);
    track.onended = () => this.ended(peer, stream.id);
    this.route(peer);
  }

  /**
   * Put the newest voice stream on the sinks, and only there.
   *
   * Idempotent, so it can run after any event without playing a stream twice.
   */
  route(peer: Peer): void {
    const voices = [...peer.audioStreams].filter(
      ([id]) => classify(peer, id) === "microphone",
    );
    const newest = voices.at(-1);
    if (!newest || newest[0] === peer.voice.streamId) return;

    this.attachVoice(peer, newest[0], newest[1]);
    this.env.changed();
  }

  /** Free a dropped peer's sinks and strips. */
  release(peer: Peer): void {
    this.env.speech.remove(peer.userId);
    this.mixer.remove(peer.userId);
    for (const element of [peer.voice.audio, peer.voice.decoder]) {
      element.srcObject = null;
      element.remove();
    }
  }

  setDeafened(deafened: boolean): void {
    if (this.deafened === deafened) return;
    this.deafened = deafened;
    for (const peer of this.env.peers.values()) peer.voice.audio.muted = deafened;
  }

  applyVolume(peer: Peer): void {
    if (peer.voice.processed) this.mixer.setVolume(peer.userId, peer.playbackVolume);
    else this.applyRawVolume(peer);
  }

  /**
   * Only a Web Audio strip can be gated or denoised; a raw `<audio>` fallback
   * has no graph to put either into, so the flag waits for the next attach.
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
    const failures = await Promise.all(peers.map((peer) => this.applyOutput(peer.voice.audio)));
    if (failures.some(Boolean)) this.env.forgetOutputDevice();
    for (const peer of peers) {
      if (!peer.voice.processed) this.applyRawVolume(peer);
    }
  }

  /** Synchronous by design: callers invoke it from an active user gesture. */
  prepare(): void {
    this.mixer.prepare();
    this.playAll();
  }

  /** Bring playback back after the tab was backgrounded. */
  async resume(): Promise<void> {
    await this.mixer.resume();
    this.playAll();
  }

  /** Drop the hidden container once the call is over. */
  removeHost(): void {
    this.host?.remove();
    this.host = null;
  }

  dispose(): void {
    this.mixer.dispose();
    this.removeHost();
  }

  private attachVoice(peer: Peer, id: string, stream: MediaStream): void {
    const { voice } = peer;
    peer.speaking = false;
    voice.audio.muted = this.deafened;
    attachStream(voice.decoder, stream);
    voice.processed = this.mixer.attach(
      peer.userId,
      stream,
      voice.audio,
      peer.playbackVolume,
      { gated: peer.gated, suppressed: peer.suppressed },
    );
    if (!voice.processed) this.playRaw(peer, stream);
    voice.streamId = id;
    void this.ensurePlayback(peer, stream);
    void this.env.speech.add(peer.userId, stream);
  }

  private ended(peer: Peer, streamId: string): void {
    if (this.env.peers.get(peer.userId) !== peer) return;
    if (!peer.audioStreams.delete(streamId)) return;

    if (peer.voice.streamId === streamId) {
      this.env.speech.remove(peer.userId);
      this.mixer.remove(peer.userId);
      peer.voice.audio.srcObject = null;
      peer.voice.decoder.srcObject = null;
      peer.voice.processed = false;
      peer.voice.streamId = null;
      peer.speaking = false;
      peer.level = 0;
    }

    // Another stream may be waiting to take over.
    this.route(peer);
    this.env.changed();
  }

  /**
   * Verify that the processed graph really started. A rejected resume or play
   * leaves both the sound and the speaking ring silent, so the raw stream is
   * the last resort on strict browsers.
   */
  private async ensurePlayback(peer: Peer, stream: MediaStream): Promise<void> {
    // Whether the stream started out on the mixer, even if the resume check
    // below moves it to the raw sink: a play() rejection after that move still
    // gets one more attempt on the raw sink.
    const processed = peer.voice.processed;
    if (processed && !(await this.mixer.resume()) && !this.useRaw(peer, stream)) return;

    try {
      await peer.voice.audio.play();
      return;
    } catch {
      if (!processed || !this.useRaw(peer, stream)) return;
    }
    // The document-level gesture hook retries this exact element on the next
    // click or key press, without making the person leave the call.
    await peer.voice.audio.play().catch(() => undefined);
  }

  /** Switch to the raw stream, unless the peer or its stream moved on meanwhile. */
  private useRaw(peer: Peer, stream: MediaStream): boolean {
    if (
      this.env.peers.get(peer.userId) !== peer ||
      peer.voice.streamId !== stream.id ||
      !peer.audioStreams.has(stream.id)
    ) {
      return false;
    }
    this.playRaw(peer, stream);
    return true;
  }

  private playRaw(peer: Peer, stream: MediaStream): void {
    this.mixer.remove(peer.userId);
    peer.voice.processed = false;
    peer.voice.decoder.srcObject = null;
    peer.voice.audio.srcObject = stream;
    this.applyRawVolume(peer);
  }

  private applyRawVolume(peer: Peer): void {
    const global = this.env.settings().outputVolume / 100;
    const participant = peer.playbackVolume / 100;
    peer.voice.audio.volume = Math.min(1, Math.max(0, global * participant));
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
    for (const { voice } of this.env.peers.values()) {
      voice.decoder.play().catch(() => undefined);
      voice.audio.play().catch(() => undefined);
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

function attachStream(element: HTMLMediaElement, stream: MediaStream): void {
  element.srcObject = stream;
  // Autoplay policies can defer playback until the next interaction; the
  // lifecycle watcher and the gesture hook retry when the tab comes forward.
  element.play().catch(() => undefined);
}
