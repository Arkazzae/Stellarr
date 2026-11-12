import { AUDIO_PROFILES, opusParameters, profileFor } from "./audioProfiles";
import { RecoveryWatchdog } from "./lifecycle";
import {
  opusFirstCodecList,
  tuneLocalDescription,
  type AudioSectionTuning,
  type AudioTuningPlan,
} from "./sdp";
import type { VoiceSettings } from "./settings";

/** Whether audio really moves across a connection that claims to be up. */
export interface MediaFlow {
  /** True only after cumulative RTP counters prove both expected directions. */
  verified: boolean;
  /** Samples taken since the connection came up without that proof. */
  silentSamples: number;
  /** After an outage the old counters prove nothing; they must advance. */
  requireFresh: boolean;
  lastSent: number;
  lastReceived: number;
}

/**
 * The `RTCPeerConnection` to Stellarr Media and what this side does with it:
 * the senders it publishes on, the offer in progress, the recovery watchdog
 * and the proof that media flows.
 *
 * Nothing here says whose media arrives on it. There is one link in total and
 * it carries everybody; the media server's directory says whose track is whose.
 */
export interface Link {
  readonly connection: RTCPeerConnection;
  /** What this side sends on the link; each is null while it is off. */
  micSender: RTCRtpSender | null;
  cameraSender: RTCRtpSender | null;
  screenVideoSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  readonly watchdog: RecoveryWatchdog;
  /** An offer of this side's is being made; a media server offer that meets it is ignored. */
  makingOffer: boolean;
  readonly flow: MediaFlow;
}

export interface LinkRecovery {
  /** How long a link may stay unhealthy before the next attempt. */
  graceMs: number;
  maxAttempts: number;
  onEscalate(link: Link): void;
  onExhausted(link: Link): void;
}

export interface LinkInit {
  iceServers: RTCIceServer[];
  recovery: LinkRecovery;
}

export function createLink(init: LinkInit): Link {
  const { recovery } = init;
  const connection = new RTCPeerConnection({
    iceServers: init.iceServers,
    // Every Stellarr connection speaks BUNDLE. Gathering one transport avoids
    // multiplying TURN allocations when more tracks are added later.
    bundlePolicy: "max-bundle",
  });

  const link: Link = {
    connection,
    micSender: null,
    cameraSender: null,
    screenVideoSender: null,
    screenAudioSender: null,
    watchdog: new RecoveryWatchdog({
      graceMs: recovery.graceMs,
      maxAttempts: recovery.maxAttempts,
      onEscalate: () => recovery.onEscalate(link),
      onExhausted: () => recovery.onExhausted(link),
    }),
    makingOffer: false,
    flow: {
      verified: false,
      silentSamples: 0,
      requireFresh: false,
      lastSent: 0,
      lastReceived: 0,
    },
  };
  return link;
}

/**
 * Start sending `track` on `link`, on a send-only transceiver of its own.
 *
 * Never `addTrack`: once the media server has added a section to forward
 * somebody's track, `addTrack` reuses that section for the new track, and a
 * section the media server created never carries what the browser sends, so
 * the track would silently go nowhere. A send-only transceiver of its own is
 * always a new section the media server accepts.
 */
export function addSender(link: Link, track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
  return link.connection.addTransceiver(track, { direction: "sendonly", streams: [stream] }).sender;
}

/**
 * What an audio section carries when the link's senders cannot say: speech,
 * the sound this side shares, or shared sound it receives from somebody else.
 */
export type AudioSectionUse = "speech" | "shared-sound" | "received-shared-sound";

export interface NegotiatorEnv {
  settings(): VoiceSettings;
  /** The send ceiling the adaptive controller currently allows. */
  bitrate(): number;
  /** Delivers a finished local description to the media server. */
  send(link: Link, type: "offer" | "answer", sdp: string): Promise<void>;
  /** Whether the shared sound being sent has two channels. */
  screenAudioStereo(): boolean;
  /**
   * What an audio section of `link` carries, for a section its senders do not
   * claim by mid; null leaves it on the speech profile. The media server
   * repeats each browser's own Opus parameters back to it, so the offer that
   * first carries a share's sound already sets its encoder, and the answer for
   * somebody else's share sets the decoder.
   */
  audioUse(link: Link, section: { mid: string | null; streamId: string | null }): AudioSectionUse | null;
}

/**
 * Makes this side's descriptions: offers of what it publishes, answers to
 * what the media server offers, each with its Opus sections tuned.
 *
 * Glare is not handled here. The browser is the impolite side, so `Sfu` never
 * hands over a media server offer that meets one of its own; the media server
 * rolls its offer back and offers again (docs/stellarr-media.md, "Negotiation
 * rules").
 */
export class Negotiator {
  constructor(private readonly env: NegotiatorEnv) {}

  /**
   * Create, apply and send an offer. Never rejects: whatever failed here is
   * retried by the next `negotiationneeded` or by the recovery watchdog.
   */
  async offer(link: Link): Promise<void> {
    link.makingOffer = true;
    try {
      await this.describe(link, "offer");
    } catch {
      // See above.
    } finally {
      link.makingOffer = false;
    }
  }

  /**
   * Apply a description from the media server and answer it when it is an
   * offer. Rejects when the browser refuses the description.
   */
  async receive(link: Link, description: RTCSessionDescriptionInit): Promise<void> {
    await link.connection.setRemoteDescription(description);

    if (description.type === "offer") {
      this.tuneMicSender(link);
      await this.describe(link, "answer");
    }
  }

  /** Opus first in the codec list, then the encoder ceiling. */
  tuneMicSender(link: Link): void {
    const sender = link.micSender;
    if (!sender) return;

    try {
      const transceiver = link.connection
        .getTransceivers()
        .find((item) => item.sender === sender);
      const capabilities =
        typeof RTCRtpReceiver !== "undefined" && RTCRtpReceiver.getCapabilities
          ? RTCRtpReceiver.getCapabilities("audio")
          : null;
      const ordered = opusFirstCodecList(capabilities?.codecs);
      if (ordered && transceiver && typeof transceiver.setCodecPreferences === "function") {
        transceiver.setCodecPreferences(ordered);
      }
    } catch {
      // Older stacks throw on an unsupported codec list; the SDP reordering
      // and the fmtp parameters still apply.
    }

    void applyEncoding(sender, this.env.bitrate());
  }

  private async describe(link: Link, type: "offer" | "answer"): Promise<void> {
    const { connection } = link;
    const description =
      type === "offer" ? await connection.createOffer() : await connection.createAnswer();
    const plan = audioTuningPlan(
      link,
      this.env.settings(),
      this.env.screenAudioStereo(),
      this.env.audioUse.bind(this.env),
    );
    const tuned = tuneLocalDescription(description, plan);

    try {
      await connection.setLocalDescription(tuned);
    } catch {
      // A stack that rejects the edited SDP still gets a working call.
      await connection.setLocalDescription(description);
    }

    const local = connection.localDescription;
    if (local) await this.env.send(link, type, local.sdp ?? "");
  }
}

/**
 * Which Opus settings each audio section of a link gets.
 *
 * Speech and shared sound share a connection but not a profile. Quality speech
 * stays mono and continuous to protect onsets; shared content keeps stereo when
 * its source really has two channels. A section this side does not send on
 * takes the speech profile, unless `audioUse` knows better.
 */
function audioTuningPlan(
  link: Link,
  settings: VoiceSettings,
  stereo: boolean,
  audioUse: NegotiatorEnv["audioUse"],
): AudioTuningPlan {
  const speech = profileFor(settings);
  const speechTuning: AudioSectionTuning = {
    parameters: opusParameters(speech),
    ptime: speech.ptime,
  };
  const music = AUDIO_PROFILES.music;
  const musicTuning: AudioSectionTuning = {
    parameters: opusParameters(music, stereo),
    ptime: music.ptime,
  };

  const byMid = new Map<string, AudioSectionTuning>();
  for (const transceiver of link.connection.getTransceivers()) {
    if (!transceiver.mid) continue;
    if (link.screenAudioSender && transceiver.sender === link.screenAudioSender) {
      byMid.set(transceiver.mid, musicTuning);
    } else if (link.micSender && transceiver.sender === link.micSender) {
      byMid.set(transceiver.mid, speechTuning);
    }
  }

  // Whatever somebody else shares may have two channels; saying so costs
  // nothing when it has one.
  const receivedTuning: AudioSectionTuning = {
    parameters: opusParameters(music, true),
    ptime: music.ptime,
  };
  const tunings: Record<AudioSectionUse, AudioSectionTuning> = {
    speech: speechTuning,
    "shared-sound": musicTuning,
    "received-shared-sound": receivedTuning,
  };
  return {
    byMid,
    bySection: (mid, streamId) => {
      const found = audioUse(link, { mid, streamId });
      return found === null ? null : tunings[found];
    },
    fallback: speechTuning,
  };
}

/** The encodings of a sender, or one blank encoding for a browser that reports none. */
export function sendEncodings(parameters: RTCRtpSendParameters): RTCRtpEncodingParameters[] {
  return parameters.encodings && parameters.encodings.length > 0 ? parameters.encodings : [{}];
}

/**
 * Cap the sender at `bitrate` and mark it high priority.
 * Resolves quietly when the browser refuses; the fmtp ceiling still bounds it.
 */
export async function applyEncoding(sender: RTCRtpSender, bitrate: number): Promise<void> {
  if (typeof sender.getParameters !== "function") return;
  try {
    const parameters = sender.getParameters();
    const encodings = sendEncodings(parameters);
    let changed = false;
    for (const encoding of encodings) {
      if (encoding.maxBitrate !== bitrate) {
        encoding.maxBitrate = bitrate;
        changed = true;
      }
      // Voice is the last thing that should yield to a background upload.
      if (encoding.networkPriority !== "high") {
        encoding.networkPriority = "high";
        encoding.priority = "high";
        changed = true;
      }
    }
    if (changed) await sender.setParameters({ ...parameters, encodings });
  } catch {
    // Firefox historically rejected mid-negotiation setParameters.
  }
}
