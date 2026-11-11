/**
 * The RTC control-plane contract: wire-level facts only.
 *
 * Nothing here may depend on SignalR or React, so the contract stays the
 * same whatever carries it.
 */
export const RTC_PROTOCOL_VERSION = 1 as const;

export type RtcProtocolVersion = typeof RTC_PROTOCOL_VERSION;
/**
 * What browsers may tell each other over `VoiceSignal`: only their own state.
 * Descriptions and candidates go to the media server over `MediaSignal`.
 */
export const RTC_SIGNAL_KINDS = ["state"] as const;
export type RtcSignalKind = (typeof RTC_SIGNAL_KINDS)[number];

/**
 * The kinds of the `MediaSignal` envelope (docs/STELLARR_MEDIA.md, "Hub leg"). A browser sends `offer`, `answer` and
 * `candidate`; the media server sends `offer`, `answer` and `tracks`, and never
 * trickles a candidate.
 */
export const MEDIA_SIGNAL_KINDS = ["offer", "answer", "candidate", "tracks"] as const;
export type MediaSignalKind = (typeof MEDIA_SIGNAL_KINDS)[number];

export const BROWSER_MEDIA_SIGNAL_KINDS = ["offer", "answer", "candidate"] as const;
export type BrowserMediaSignalKind = (typeof BROWSER_MEDIA_SIGNAL_KINDS)[number];

export const MEDIA_SERVER_SIGNAL_KINDS = ["offer", "answer", "tracks"] as const;
export type MediaServerSignalKind = (typeof MEDIA_SERVER_SIGNAL_KINDS)[number];

/** Why the media plane ended a session that its seat still needed. */
export const MEDIA_SESSION_CLOSE_REASONS = ["media-restarted", "transport-timeout", "error"] as const;
export type MediaSessionCloseReason = (typeof MEDIA_SESSION_CLOSE_REASONS)[number];

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
    mediaSignal: "MediaSignal",
    mediaSessionClosed: "MediaSessionClosed",
  }),
  methods: Object.freeze({
    join: "JoinVoice",
    leave: "LeaveVoice",
    declineDirectCall: "DeclineDirectCall",
    signal: "SendVoiceSignal",
    playSoundboard: "PlaySoundboard",
    clock: "GetRtcClock",
    openMediaSession: "OpenMediaSession",
    mediaSignal: "SendMediaSignal",
  }),
});

export interface RtcStatePayload {
  muted: boolean;
  screenStreamId: string | null;
  /** Optional on the wire so clients that predate it can ignore it. */
  cameraStreamId: string | null;
}

/**
 * One entry of a media session's directory: whose track arrives on the
 * receiving section `mid` of the browser's connection. The media server issues
 * it, so the publisher cannot claim somebody else's track.
 */
export interface MediaTrack {
  mid: string;
  /** The account that publishes the track, taken from its seat. */
  userId: string;
  kind: "audio" | "video";
  /**
   * The stream id the publisher gives the track now: the `screenStreamId` or
   * `cameraStreamId` of its `state` frame for a share or a camera.
   */
  streamId: string;
}

/** What the media server offers: the description, its number, and the directory to go with it. */
export interface MediaServerOffer {
  type: "offer";
  sdp: string;
  /** Echoed in the answer; the media server drops an answer with another number. */
  negotiationId: number;
  tracks: MediaTrack[];
}

/** The browser's answer to a media server offer. */
export interface BrowserAnswer {
  type: "answer";
  sdp: string;
  negotiationId: number;
}

export function isRtcSignalKind(value: unknown): value is RtcSignalKind {
  return RTC_SIGNAL_KINDS.some((kind) => kind === value);
}

export function isMediaSignalKind(value: unknown): value is MediaSignalKind {
  return MEDIA_SIGNAL_KINDS.some((kind) => kind === value);
}

export function isBrowserMediaSignalKind(value: unknown): value is BrowserMediaSignalKind {
  return BROWSER_MEDIA_SIGNAL_KINDS.some((kind) => kind === value);
}

export function isMediaServerSignalKind(value: unknown): value is MediaServerSignalKind {
  return MEDIA_SERVER_SIGNAL_KINDS.some((kind) => kind === value);
}

export function isMediaSessionCloseReason(value: unknown): value is MediaSessionCloseReason {
  return MEDIA_SESSION_CLOSE_REASONS.some((reason) => reason === value);
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

// The payloads of the `MediaSignal` envelope, one encoder and one decoder per
// row of the table in docs/STELLARR_MEDIA.md. Both directions are here: the
// browser needs its own half, and fakes of the media server need the other.
// A decoder takes the whole payload or nothing; a directory with one bad entry
// would file somebody's track under the wrong person.

/** The browser's offer of what it publishes: `{ type: "offer", sdp }`. */
export function encodeBrowserOffer(sdp: string): string {
  return encodeRtcDescription("offer", sdp);
}

export function decodeBrowserOffer(payload: string): RTCSessionDescriptionInit | null {
  return decodeRtcDescription(payload, "offer");
}

/** The media server's answer to a browser offer: `{ type: "answer", sdp }`. */
export function encodeMediaServerAnswer(sdp: string): string {
  return encodeRtcDescription("answer", sdp);
}

export function decodeMediaServerAnswer(payload: string): RTCSessionDescriptionInit | null {
  return decodeRtcDescription(payload, "answer");
}

/** The media server's offer of what it forwards, with its number and the directory. */
export function encodeMediaServerOffer(offer: Omit<MediaServerOffer, "type">): string {
  return JSON.stringify({
    type: "offer",
    sdp: offer.sdp,
    negotiationId: offer.negotiationId,
    tracks: offer.tracks.map(encodeMediaTrack),
  });
}

export function decodeMediaServerOffer(payload: string): MediaServerOffer | null {
  const record = parseRecord(payload);
  if (record === null || record.type !== "offer" || typeof record.sdp !== "string") return null;
  const { negotiationId } = record;
  if (!isNegotiationId(negotiationId)) return null;
  const tracks = decodeTrackList(record.tracks);
  return tracks === null ? null : { type: "offer", sdp: record.sdp, negotiationId, tracks };
}

/** The browser's answer to a media server offer, echoing that offer's number. */
export function encodeBrowserAnswer(sdp: string, negotiationId: number): string {
  return JSON.stringify({ type: "answer", sdp, negotiationId });
}

export function decodeBrowserAnswer(payload: string): BrowserAnswer | null {
  const record = parseRecord(payload);
  if (record === null || record.type !== "answer" || typeof record.sdp !== "string") return null;
  const { negotiationId } = record;
  return isNegotiationId(negotiationId) ? { type: "answer", sdp: record.sdp, negotiationId } : null;
}

/** A browser's ICE candidate, or `null` for end-of-candidates; the v1 candidate payload. */
export function encodeMediaCandidate(candidate: RTCIceCandidateInit | null): string {
  return encodeRtcCandidate(candidate);
}

/** `null` is end-of-candidates and `undefined` a payload that is not a candidate. */
export function decodeMediaCandidate(payload: string): RTCIceCandidateInit | null | undefined {
  return decodeRtcCandidate(payload);
}

/** The whole directory of the session, never a delta: `{ tracks: [Track] }`. */
export function encodeMediaTracks(tracks: readonly MediaTrack[]): string {
  return JSON.stringify({ tracks: tracks.map(encodeMediaTrack) });
}

export function decodeMediaTracks(payload: string): MediaTrack[] | null {
  const record = parseRecord(payload);
  return record === null ? null : decodeTrackList(record.tracks);
}

/**
 * One directory entry as it goes on the wire: the contract's fields and
 * nothing else the caller's object carries. An entry never travels alone, so
 * this and `decodeMediaTrack` work on the object inside `tracks`, not on a
 * string.
 */
export function encodeMediaTrack({ mid, userId, kind, streamId }: MediaTrack): MediaTrack {
  return { mid, userId, kind, streamId };
}

/** One directory entry from an untrusted value, or null when it is not one. */
export function decodeMediaTrack(value: unknown): MediaTrack | null {
  if (!isRecord(value)) return null;
  const { mid, userId, kind, streamId } = value;
  if (!isNonEmptyString(mid) || !isNonEmptyString(userId)) return null;
  if (kind !== "audio" && kind !== "video") return null;
  // A stream id is whatever the publisher chose, so any string is one. It is
  // compared, never parsed.
  if (typeof streamId !== "string") return null;
  return { mid, userId, kind, streamId };
}

/** A directory names each section once; two entries for one `mid` make it unusable. */
function decodeTrackList(value: unknown): MediaTrack[] | null {
  if (!Array.isArray(value)) return null;
  const tracks: MediaTrack[] = [];
  const mids = new Set<string>();
  for (const item of value) {
    const track = decodeMediaTrack(item);
    if (track === null || mids.has(track.mid)) return null;
    mids.add(track.mid);
    tracks.push(track);
  }
  return tracks;
}

/** The media server numbers its offers with non-negative integers. */
function isNegotiationId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
