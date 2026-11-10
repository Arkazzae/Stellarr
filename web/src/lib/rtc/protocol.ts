/**
 * The RTC control-plane contract: wire-level facts only.
 *
 * Nothing here may depend on SignalR, React or a particular media topology,
 * so the same contract can sit under a browser mesh or a media server.
 */
export const RTC_PROTOCOL_VERSION = 1 as const;

export type RtcProtocolVersion = typeof RTC_PROTOCOL_VERSION;
export type RtcTopology = "mesh" | "sfu";

export const RTC_SIGNAL_KINDS = ["offer", "answer", "candidate", "state"] as const;
export type RtcSignalKind = (typeof RTC_SIGNAL_KINDS)[number];

export const RTC_HUB = Object.freeze({
  url: "/hubs/app",
  events: Object.freeze({
    participants: "VoiceParticipantChanged",
    sessionReplaced: "VoiceSessionReplaced",
    directCallDeclined: "DirectCallDeclined",
    signal: "VoiceSignal",
    soundboardPlayed: "SoundboardPlayed",
    soundboardChanged: "SoundboardChanged",
    joinSoundPlayed: "JoinSoundPlayed",
  }),
  methods: Object.freeze({
    join: "JoinVoice",
    leave: "LeaveVoice",
    declineDirectCall: "DeclineDirectCall",
    signal: "SendVoiceSignal",
    playSoundboard: "PlaySoundboard",
    clock: "GetRtcClock",
  }),
});

export interface RtcStatePayload {
  muted: boolean;
  screenStreamId: string | null;
  /** Optional on the wire so clients that predate it can ignore it. */
  cameraStreamId: string | null;
}

export function isRtcSignalKind(value: unknown): value is RtcSignalKind {
  return RTC_SIGNAL_KINDS.some((kind) => kind === value);
}

export function encodeRtcDescription(type: "offer" | "answer", sdp: string): string {
  return JSON.stringify({ type, sdp });
}

export function decodeRtcDescription(
  payload: string,
  expectedType: "offer" | "answer",
): RTCSessionDescriptionInit | null {
  const record = parseRecord(payload);
  if (record === null || record.type !== expectedType) return null;
  return typeof record.sdp === "string" ? { type: expectedType, sdp: record.sdp } : null;
}

/** `null` is the end-of-candidates marker. */
export function encodeRtcCandidate(candidate: RTCIceCandidateInit | null): string {
  return JSON.stringify(candidate);
}

/**
 * Returns `null` for the end-of-candidates marker and `undefined` for a
 * payload that is not a candidate at all.
 */
export function decodeRtcCandidate(payload: string): RTCIceCandidateInit | null | undefined {
  const value = parseJson(payload);
  if (value === null) return null;
  if (!isRecord(value) || typeof value.candidate !== "string") return undefined;

  const sdpMid = optionalField(value.sdpMid, isString);
  const sdpMLineIndex = optionalField(value.sdpMLineIndex, isLineIndex);
  const usernameFragment = optionalField(value.usernameFragment, isString);
  if (sdpMid === undefined || sdpMLineIndex === undefined || usernameFragment === undefined) {
    return undefined;
  }

  return {
    candidate: value.candidate,
    ...(sdpMid !== null && { sdpMid }),
    ...(sdpMLineIndex !== null && { sdpMLineIndex }),
    ...(usernameFragment !== null && { usernameFragment }),
  };
}

export function encodeRtcState(state: RtcStatePayload): string {
  return JSON.stringify(state);
}

export function decodeRtcState(payload: string): RtcStatePayload | null {
  const record = parseRecord(payload);
  if (record === null) return null;

  const { muted, screenStreamId, cameraStreamId = null } = record;
  if (typeof muted !== "boolean") return null;
  if (screenStreamId !== null && typeof screenStreamId !== "string") return null;
  if (cameraStreamId !== null && typeof cameraStreamId !== "string") return null;
  return { muted, screenStreamId, cameraStreamId };
}

/** Valid JSON never parses to `undefined`, so that stands for a parse failure. */
function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function parseRecord(payload: string): Record<string, unknown> | null {
  const value = parseJson(payload);
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isLineIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Reads an optional wire field: `null` when it is absent, `undefined` when it
 * is present with the wrong type.
 */
function optionalField<T>(
  value: unknown,
  accepts: (candidate: unknown) => candidate is T,
): T | null | undefined {
  if (value === undefined || value === null) return null;
  return accepts(value) ? value : undefined;
}
