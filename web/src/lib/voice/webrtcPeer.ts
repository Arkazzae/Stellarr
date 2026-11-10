import type { UserId, VoiceOccupant } from "@/lib/api/types";
import { AUDIO_PROFILES, opusParameters, profileFor } from "./audioProfiles";
import { RemoteCandidateQueue } from "./candidates";
import { RecoveryWatchdog } from "./lifecycle";
import type { ParticipantPreference } from "./participantPreferences";
import {
  opusFirstCodecList,
  tuneLocalDescription,
  type AudioSectionTuning,
  type AudioTuningPlan,
} from "./sdp";
import type { VoiceSettings } from "./settings";
import { RemoteMedia } from "./webrtcRemoteMedia";

/**
 * What plays one remote audio source, a microphone or a screen share's sound:
 * an audible sink and a muted decoding sink.
 */
export interface RemoteVoice {
  /** The audible element. Holds the mixer's output, or the raw stream as a fallback. */
  audio: HTMLAudioElement;
  /** Muted direct sink that keeps Chromium's WebRTC jitter buffer decoding. */
  decoder: HTMLAudioElement;
  /** False when Web Audio was unavailable and the raw remote stream is playing. */
  processed: boolean;
  /** The stream currently attached, if any. */
  streamId: string | null;
}

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
  /** Set only after the final recovery attempt had time to settle. */
  recoveryFailed: boolean;
}

/** One other person in the call: a connection and everything hanging off it. */
export interface Peer {
  readonly userId: UserId;
  displayName: string;
  muted: boolean;
  speaking: boolean;
  /** Smoothed input level, 0..1. */
  level: number;
  /** Local receiver-side strip, 0..200 percent. */
  playbackVolume: number;
  /** Local receiver-side gate on this person's strip. */
  gated: boolean;
  /** Local receiver-side suppressor on this person's strip. */
  suppressed: boolean;
  readonly connection: RTCPeerConnection;
  readonly voice: RemoteVoice;
  /** Sinks for their shared-screen sound, which never shares an element with the voice. */
  screenAudio: RemoteVoice | null;
  /** Every remote stream seen, so routing can be re-evaluated at will. */
  readonly media: RemoteMedia;
  readonly candidates: RemoteCandidateQueue;
  /** What this side sends to this person; each is null while it is off. */
  micSender: RTCRtpSender | null;
  cameraSender: RTCRtpSender | null;
  screenVideoSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  readonly watchdog: RecoveryWatchdog;
  /** Perfect-negotiation bookkeeping (https://w3c.github.io/webrtc-pc/#perfect-negotiation). */
  readonly polite: boolean;
  makingOffer: boolean;
  settingRemoteAnswerPending: boolean;
  readonly flow: MediaFlow;
}

export interface PeerRecovery {
  /** How long a peer may stay unhealthy before the next attempt. */
  graceMs: number;
  maxAttempts: number;
  onEscalate(peer: Peer): void;
  onExhausted(peer: Peer): void;
}

export interface PeerInit {
  user: VoiceOccupant;
  selfUserId: UserId;
  iceServers: RTCIceServer[];
  /** How this account last heard the person. */
  preference: ParticipantPreference;
  /**
   * Builds the peer's sinks. Called once the connection exists, so a
   * connection that cannot be constructed leaves no audio element behind.
   */
  createVoice(): RemoteVoice;
  recovery: PeerRecovery;
}

export function createPeer(init: PeerInit): Peer {
  const { user, preference, recovery } = init;
  const connection = new RTCPeerConnection({
    iceServers: init.iceServers,
    // Every Stellarr peer speaks BUNDLE. Gathering one transport avoids
    // multiplying TURN allocations when more tracks are added later.
    bundlePolicy: "max-bundle",
  });

  const peer: Peer = {
    userId: user.userId,
    displayName: user.displayName,
    muted: user.muted,
    speaking: false,
    level: 0,
    playbackVolume: preference.volume,
    gated: preference.gated,
    suppressed: preference.suppressed,
    connection,
    voice: init.createVoice(),
    screenAudio: null,
    media: new RemoteMedia(),
    candidates: new RemoteCandidateQueue({
      hasRemoteDescription: () => connection.remoteDescription !== null,
      addIceCandidate: (candidate) => connection.addIceCandidate(candidate ?? undefined),
    }),
    micSender: null,
    cameraSender: null,
    screenVideoSender: null,
    screenAudioSender: null,
    watchdog: new RecoveryWatchdog({
      graceMs: recovery.graceMs,
      maxAttempts: recovery.maxAttempts,
      onEscalate: () => recovery.onEscalate(peer),
      onExhausted: () => recovery.onExhausted(peer),
    }),
    // Deterministic roles: the lexicographically larger id is the polite side.
    polite: init.selfUserId > user.userId,
    makingOffer: false,
    settingRemoteAnswerPending: false,
    flow: {
      verified: false,
      silentSamples: 0,
      requireFresh: false,
      lastSent: 0,
      lastReceived: 0,
      recoveryFailed: false,
    },
  };
  return peer;
}

export interface NegotiatorEnv {
  settings(): VoiceSettings;
  /** The send ceiling the adaptive controller currently allows. */
  bitrate(): number;
  /** Delivers a finished local description to the other side. */
  send(peer: Peer, type: "offer" | "answer", sdp: string): Promise<void>;
  /** The remote description told more about what the peer's streams carry. */
  remoteMediaLearned(peer: Peer): void;
  /** Whether the shared sound being sent has two channels. */
  screenAudioStereo(): boolean;
}

/**
 * Offers and answers for every peer, following the WebRTC spec's perfect
 * negotiation recipe.
 *
 * Both sides may offer at once, because the hub hands every participant the
 * same snapshot at the same moment, so glare is the normal case rather than an
 * edge case. The polite side yields; the impolite side drops the colliding offer.
 */
export class Negotiator {
  constructor(private readonly env: NegotiatorEnv) {}

  /**
   * Create, apply and send an offer. Never rejects: whatever failed here is
   * retried by the next `negotiationneeded` or by the recovery watchdog.
   */
  async offer(peer: Peer): Promise<void> {
    peer.makingOffer = true;
    try {
      await this.describe(peer, "offer");
    } catch {
      // See above.
    } finally {
      peer.makingOffer = false;
    }
  }

  /** Apply a description from the other side and answer it when it is an offer. */
  async receive(peer: Peer, description: RTCSessionDescriptionInit): Promise<void> {
    const { connection } = peer;
    const readyForOffer =
      !peer.makingOffer &&
      (connection.signalingState === "stable" || peer.settingRemoteAnswerPending);
    const collision = description.type === "offer" && !readyForOffer;
    if (collision && !peer.polite) return;

    peer.settingRemoteAnswerPending = description.type === "answer";
    try {
      await connection.setRemoteDescription(description);
    } catch (error) {
      if (!collision) throw error;
      // Implicit rollback is standard but not universal; do it by hand, once.
      await connection.setLocalDescription({ type: "rollback" });
      await connection.setRemoteDescription(description);
    } finally {
      peer.settingRemoteAnswerPending = false;
    }

    // The description names the msids that carry video and lands before any
    // track event, so routing can be right the first time.
    peer.media.learnFromSdp(connection.remoteDescription?.sdp);
    this.env.remoteMediaLearned(peer);

    await peer.candidates.flush();

    if (description.type === "offer") {
      this.tuneMicSender(peer);
      await this.describe(peer, "answer");
    }
  }

  /** Opus first in the codec list, then the encoder ceiling. */
  tuneMicSender(peer: Peer): void {
    const sender = peer.micSender;
    if (!sender) return;

    try {
      const transceiver = peer.connection
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

  private async describe(peer: Peer, type: "offer" | "answer"): Promise<void> {
    const { connection } = peer;
    const description =
      type === "offer" ? await connection.createOffer() : await connection.createAnswer();
    const plan = audioTuningPlan(peer, this.env.settings(), this.env.screenAudioStereo());
    const tuned = tuneLocalDescription(description, plan);

    try {
      await connection.setLocalDescription(tuned);
    } catch {
      // A stack that rejects the edited SDP still gets a working call.
      await connection.setLocalDescription(description);
    }

    const local = connection.localDescription;
    if (local) await this.env.send(peer, type, local.sdp ?? "");
  }
}

/**
 * Which Opus settings each audio section of this peer's connection gets.
 *
 * Speech and shared sound share a connection but not a profile. Quality speech
 * stays mono and continuous to protect onsets; shared content keeps stereo when
 * its source really has two channels.
 */
function audioTuningPlan(peer: Peer, settings: VoiceSettings, stereo: boolean): AudioTuningPlan {
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
  for (const transceiver of peer.connection.getTransceivers()) {
    if (!transceiver.mid) continue;
    if (peer.screenAudioSender && transceiver.sender === peer.screenAudioSender) {
      byMid.set(transceiver.mid, musicTuning);
    } else if (peer.micSender && transceiver.sender === peer.micSender) {
      byMid.set(transceiver.mid, speechTuning);
    }
  }
  return { byMid, fallback: speechTuning };
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
