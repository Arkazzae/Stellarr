import type { CallVM, PersonVM, ScreenShareVM } from "@/components/view-models";
import { initials } from "@/lib/format";
import type { VoicePeer, VoiceState } from "@/lib/voice/types";

/** How a room outside the server directory, such as a DM call, presents itself. */
export interface VoiceRoomPresentation {
  /** Human-readable dock label for rooms not present in the server directory. */
  label: string;
  /** People to show before their peer connection has finished negotiating. */
  people?: readonly PersonVM[];
  privateCall?: boolean;
}

const NO_CAMERAS: ReadonlyMap<string, MediaStream> = new Map();

/** Which screen share is on show, if any, and who owns it. */
export interface ShareSource {
  /**
   * Names one concrete stream, so opting in to watch it never carries over to
   * the next stream or owner a reconnect brings.
   */
  key: string | null;
  ownerId: string | null;
  remote: VoicePeer | null;
}

/** The local share wins; otherwise the first remote one. */
export function shareSourceOf(state: VoiceState, userId: string | null): ShareSource {
  const self = userId ?? "self";
  if (state.localScreen !== null) {
    return { key: `local:${self}:${state.localScreen.streamId}`, ownerId: self, remote: null };
  }
  const remote = state.peers.find((peer) => peer.screen !== null) ?? null;
  if (remote?.screen) {
    return {
      key: `remote:${remote.userId}:${remote.screen.streamId}`,
      ownerId: remote.userId,
      remote,
    };
  }
  return { key: null, ownerId: null, remote: null };
}

/** The dock's headline: a live screen outranks transport status. */
export function callHeadline(state: VoiceState): CallVM["headline"] {
  const { connection, transport } = state;
  if (connection === "connected" && state.localScreen !== null) return "screen";
  if (connection === "requesting-mic") return "requesting-mic";
  if (connection === "failed" || transport.media === "failed") return "failed";
  if (
    connection === "reconnecting" ||
    transport.signaling === "reconnecting" ||
    transport.signaling === "disconnected"
  ) {
    return "reconnecting";
  }
  if (transport.media === "degraded") return "degraded";
  if (connection === "connecting" || transport.media === "connecting") return "connecting";
  return "connected";
}

function speakingApplier(peers: readonly VoicePeer[]) {
  const byId = new Map(peers.map((peer) => [peer.userId, peer]));
  return (people: PersonVM[]): PersonVM[] =>
    people.map((person) => {
      const peer = byId.get(person.id);
      return peer === undefined
        ? person
        : { ...person, speaking: peer.speaking, muted: peer.muted };
    });
}

/** Remote participants only: the sender's own strip has no receiver-side setting. */
function remoteSettings<T>(
  peers: readonly VoicePeer[],
  pick: (peer: VoicePeer) => T,
): ReadonlyMap<string, T> {
  return new Map(peers.filter((peer) => !peer.self).map((peer) => [peer.userId, pick(peer)]));
}

function cameraStreamsOf(
  state: VoiceState,
  userId: string | null,
): ReadonlyMap<string, MediaStream> {
  const cameras = state.peers.flatMap((peer) =>
    peer.camera?.stream ? [[peer.userId, peer.camera.stream] as const] : [],
  );
  if (state.localCamera?.stream && userId !== null) {
    cameras.push([userId, state.localCamera.stream]);
  }
  return cameras.length > 0 ? new Map(cameras) : NO_CAMERAS;
}

export interface VoiceViewInput {
  state: VoiceState;
  userId: string | null;
  displayName: string;
  /** Epoch ms the holder saw the call begin; null exactly when there is no call. */
  startedAt: number | null;
  deafened: boolean;
  /** The caller's presentation of the joined channel, when it gave one. */
  room: VoiceRoomPresentation | null;
  /** What the dock calls the joined channel. */
  roomName: string | null;
  /** The viewer opted in to the share that is currently on show. */
  watching: boolean;
  occupantsOf: (channelId: string) => PersonVM[];
  source: ShareSource;
}

export interface VoiceView {
  call: CallVM | null;
  people: PersonVM[];
  applySpeaking: (people: PersonVM[]) => PersonVM[];
  share: ScreenShareVM | null;
  privateCall: boolean;
  cameraStreams: ReadonlyMap<string, MediaStream>;
  participantVolumes: ReadonlyMap<string, number>;
  participantGates: ReadonlyMap<string, boolean>;
  participantSuppressions: ReadonlyMap<string, boolean>;
}

/** Everything the call UI reads, derived from one RTC snapshot. */
export function deriveVoiceView(input: VoiceViewInput): VoiceView {
  const { state, room, userId } = input;
  const { channelId } = state;
  const privateCall = channelId !== null && room?.privateCall === true;
  const applySpeaking = speakingApplier(state.peers);

  return {
    call: deriveCall(input, privateCall),
    people: derivePeople(input, applySpeaking),
    applySpeaking,
    share: deriveShare(input),
    privateCall,
    cameraStreams: cameraStreamsOf(state, userId),
    participantVolumes: remoteSettings(state.peers, (peer) => peer.playbackVolume),
    participantGates: remoteSettings(state.peers, (peer) => peer.gated),
    participantSuppressions: remoteSettings(state.peers, (peer) => peer.suppressed),
  };
}

function deriveCall(input: VoiceViewInput, privateCall: boolean): CallVM | null {
  const { state, startedAt, roomName } = input;
  if (state.channelId === null || startedAt === null || roomName === null) return null;
  if (state.connection === "idle") return null;

  const rttMs = state.diagnostics.rttMs;
  return {
    channelId: state.channelId,
    channelName: roomName,
    ...(privateCall ? { privateCall: true } : {}),
    startedAt,
    muted: state.muted,
    deafened: input.deafened,
    cameraOn: state.localCamera !== null,
    cameraPending: state.cameraPending,
    sharing: state.localScreen !== null,
    latencyMs: rttMs === null ? null : Math.max(0, Math.round(rttMs)),
    connectionQuality: state.diagnostics.quality,
    headline: callHeadline(state),
  };
}

// The directory knows who the server placed on the channel; the RTC layer knows
// who actually negotiated. Neither is a superset of the other during a join, so
// the stage shows the union.
function derivePeople(
  input: VoiceViewInput,
  applySpeaking: (people: PersonVM[]) => PersonVM[],
): PersonVM[] {
  const { state, room } = input;
  const { channelId } = state;
  const presented = room?.people ?? [];
  const listed =
    channelId === null
      ? []
      : applySpeaking(presented.length > 0 ? [...presented] : input.occupantsOf(channelId));

  const known = new Set(listed.map((person) => person.id));
  const negotiated = state.peers
    .filter((peer) => !known.has(peer.userId))
    .map(
      (peer): PersonVM => ({
        id: peer.userId,
        displayName: peer.displayName,
        initials: initials(peer.displayName),
        presence: "online",
        speaking: peer.speaking,
        muted: peer.muted,
      }),
    );
  return [...listed, ...negotiated];
}

function deriveShare(input: VoiceViewInput): ScreenShareVM | null {
  const { state, source } = input;
  if (state.localScreen !== null) {
    return {
      ownerId: input.userId ?? "",
      ownerName: input.displayName,
      hasAudio: state.localScreen.hasAudio,
      // The capture already belongs to this tab. Previewing it muted costs no
      // second capture and shows the sharer what is really being sent.
      stream: state.localScreen.stream,
      watching: true,
    };
  }
  const { remote } = source;
  if (remote?.screen == null) return null;
  return {
    ownerId: remote.userId,
    ownerName: remote.displayName,
    hasAudio: remote.screen.hasAudio,
    stream: input.watching ? remote.screen.stream : null,
    watching: input.watching,
  };
}
