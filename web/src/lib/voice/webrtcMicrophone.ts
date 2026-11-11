import type { Translator } from "@/i18n";
import type { UserId } from "@/lib/api/types";
import { profileFor, usesWorkletSuppression } from "./audioProfiles";
import { captureMicrophone, type MicCapture } from "./micPipeline";
import { needsRecapture, type VoiceSettings } from "./settings";
import type { VoiceStateStore } from "./store";
import type { SpeechDetector } from "./vad";
import { degradedNotice, micError, micSwapFailedError } from "./webrtcErrors";
import { addSender, type Link } from "./webrtcPeer";

export interface LocalMicrophoneEnv {
  readonly selfUserId: UserId;
  /** Words what goes wrong, in the language the person has now. */
  readonly translate: Translator;
  readonly store: VoiceStateStore;
  /** Lights the speaking ring from the audio before the input gate. */
  readonly speech: SpeechDetector;
  /** The links the microphone is sent on. */
  links(): Iterable<Link>;
  /** Cap every microphone sender at the adaptive controller's ceiling. */
  applyEncoding(): Promise<void>;
  /** Replace a link whose sender refused even to take the swap back. */
  rebuildLink(link: Link): Promise<void>;
  /** The device ended underneath the call, e.g. a headset was unplugged. */
  onDeviceLost(): void;
}

interface MicrophoneTarget {
  readonly link: Link;
  readonly sender: RTCRtpSender;
}

/**
 * The microphone this client sends: its capture, mute state, and the swap to
 * a new capture without leaving the call.
 *
 * The capture owns every disposable thing behind it, so replacing it is a
 * matter of building a new one and releasing the old; a leaked device handle
 * would keep the operating system's recording indicator lit.
 */
export class LocalMicrophone {
  private active: MicCapture | null = null;
  /** The settings that produced `active`. */
  private activeSettings: VoiceSettings | null = null;

  constructor(private readonly env: LocalMicrophoneEnv) {}

  get capture(): MicCapture | null {
    return this.active;
  }

  /** Start sending `capture`, which was opened with `settings`. */
  adopt(capture: MicCapture, settings: VoiceSettings): void {
    this.active = capture;
    this.activeSettings = settings;
    capture.rawTrack.contentHint = profileFor(settings).contentHint;
    this.applyMute(capture, this.env.store.getSnapshot().muted);
    // The detector listens before the gate: the ring must light from the same
    // decision that opens the gate, not from audio the gate already cut.
    void this.env.speech.add(this.env.selfUserId, capture.monitorStream, true);

    this.env.store.set({
      noiseSuppressionActive: usesWorkletSuppression(capture.noiseSuppression),
      // Reports what is actually running, not what was requested. Claiming
      // "browser suppression took over" while the device is running with
      // suppression switched off would be worse than saying nothing.
      degraded: degradedNotice(
        this.env.translate,
        settings.noiseSuppression,
        capture.noiseSuppression,
        { requested: settings.inputGate, active: capture.gateActive },
        { requested: settings.autoGainControl, active: capture.autoGain },
      ),
    });

    capture.rawTrack.onended = () => this.env.onDeviceLost();
  }

  /** Put the microphone on a link that was just made. */
  addTo(link: Link): void {
    const capture = this.active;
    if (!capture || link.micSender) return;
    try {
      link.micSender = addSender(link, capture.track, capture.stream);
    } catch {
      // A connection that cannot take the track is about to be rebuilt.
    }
  }

  /** Stop the device and forget the capture. */
  release(): void {
    this.env.speech.remove(this.env.selfUserId);
    if (this.active) this.active.rawTrack.onended = null;
    this.active?.dispose();
    this.active = null;
    this.activeSettings = null;
  }

  /** Only the microphone: shared system sound is content, not the person's voice. */
  setMuted(muted: boolean): void {
    if (this.active) this.applyMute(this.active, muted);
  }

  /** Retune the running capture without reopening the device. */
  tune(settings: VoiceSettings): void {
    this.active?.setSensitivity(settings.vadSensitivity);
    this.active?.setInputGain(settings.inputGainDb);
  }

  /** True when `next` needs a capture different from the one running. */
  needsReopen(next: VoiceSettings): boolean {
    return this.activeSettings !== null && needsRecapture(this.activeSettings, next);
  }

  /**
   * Wake a capture graph the browser suspended. A suspended graph sends a
   * valid but silent track, so false means the device has to be reopened.
   */
  async resume(): Promise<boolean> {
    const capture = this.active;
    if (!capture) return true;
    return (await capture.resume()) || !capture.processed;
  }

  /**
   * Reopen the microphone for `next` and move every link onto it.
   *
   * Without `force`, only a capture-affecting change does anything. If the new
   * device cannot be opened, or one link cannot take it, the old capture is
   * still running, so the call goes on and the error is reported as
   * recoverable rather than fatal. A newer request discards the capture, undoing
   * sender changes while the previous capture still owns the call. A capture
   * belonging to a later call is never changed. Resolves to whether a new
   * capture took over.
   */
  async replace(
    next: VoiceSettings,
    force: boolean,
    superseded: () => boolean,
  ): Promise<boolean> {
    const previous = this.active;
    if (!previous || (!force && !this.needsReopen(next))) return false;

    let capture: MicCapture;
    try {
      capture = await captureMicrophone(next, { translate: this.env.translate });
    } catch (cause) {
      if (this.active === previous && !superseded()) {
        this.env.store.set({ error: { ...micError(this.env.translate, cause), recoverable: true } });
      }
      return false;
    }
    if (this.active !== previous || superseded()) {
      capture.dispose();
      return false;
    }

    this.applyMute(capture, this.env.store.getSnapshot().muted);
    // Up from silence rather than straight in at level: a suppressor or gate
    // change swaps the track under a running call, and two graphs never meet
    // at the same sample or settle at the same loudness.
    capture.fadeIn();
    const targets = [...this.env.links()].flatMap((link) =>
      link.micSender ? [{ link, sender: link.micSender }] : [],
    );
    if (!(await this.moveAllLinks(capture.track, previous, targets))) {
      capture.dispose();
      if (this.active === previous && !superseded()) {
        this.env.store.set({ error: micSwapFailedError(this.env.translate) });
      }
      return false;
    }
    // A newer settings request needs its old microphone back. A later call
    // already has its own capture and senders, which this operation cannot own.
    if (this.active !== previous || superseded()) {
      try {
        await this.moveBackTo(previous, targets);
      } finally {
        capture.dispose();
      }
      return false;
    }

    this.adopt(capture, next);
    previous.rawTrack.onended = null;
    previous.dispose();
    this.env.store.set({ error: null });
    return true;
  }

  /**
   * Restore only the senders this swap moved, while its original capture is
   * still active. Recheck ownership after each await: leaving and rejoining
   * must not restore a disposed track or rebuild links of a later call.
   */
  private async moveBackTo(
    previous: MicCapture,
    targets: readonly MicrophoneTarget[],
  ): Promise<void> {
    for (const { link, sender } of targets) {
      if (this.active !== previous) return;
      if (link.micSender !== sender || ![...this.env.links()].includes(link)) continue;
      try {
        await sender.replaceTrack(previous.track);
      } catch {
        if (
          this.active === previous &&
          link.micSender === sender &&
          [...this.env.links()].includes(link)
        ) {
          await this.env.rebuildLink(link);
        }
      }
    }
  }

  /**
   * Swap the track on every sender, all or nothing.
   *
   * Successful swaps are rolled back when one fails. A sender that refuses
   * even the rollback belongs to a broken connection, which is rebuilt while
   * `active` still points at the old capture.
   */
  private async moveAllLinks(
    track: MediaStreamTrack,
    previous: MicCapture,
    targets: readonly MicrophoneTarget[],
  ): Promise<boolean> {
    const attempts = await Promise.allSettled(
      targets.map(({ sender }) => sender.replaceTrack(track)),
    );
    if (attempts.every((result) => result.status === "fulfilled")) {
      if (this.active === previous) await this.env.applyEncoding();
      return true;
    }

    const moved = targets.filter((_, index) => attempts[index]?.status === "fulfilled");
    await this.moveBackTo(previous, moved);
    return false;
  }

  private applyMute(capture: MicCapture, muted: boolean): void {
    capture.rawTrack.enabled = !muted;
    if (capture.track !== capture.rawTrack) capture.track.enabled = !muted;
  }
}
