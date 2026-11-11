import type {
  ChannelId,
  ChannelReadChanged,
  Message,
  MessageDeleted,
  MessageEmbedsUpdate,
  MessageReactionChanged,
  Presence,
  RtcConfig,
  Server,
  ServerPermission,
  SoundboardPlayedEvent,
  SoundboardSound,
  User,
  UserId,
  VoiceOccupant,
} from "@/lib/api/types";
import type {
  BrowserMediaSignalKind,
  MediaServerSignalKind,
  MediaSessionCloseReason,
  MediaSignalKind,
  RtcProtocolVersion,
  RtcSignalKind,
} from "@/lib/rtc/protocol";
import type { NotificationInboxChangedEvent } from "@/ports/notifications";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface PresenceChangedEvent {
  userId: UserId;
  presence: Presence;
}

export interface TypingChangedEvent {
  channelId: ChannelId;
  userId: UserId;
  displayName: string;
  expiresAt: string;
}

/** The full occupancy of one voice channel. */
export interface VoiceParticipantChangedEvent {
  channelId: ChannelId;
  /** Monotonic within a server process; absent only from older servers. */
  sequence?: number;
  participants: VoiceOccupant[];
}

export interface VoiceSessionReplacedEvent {
  channelId: ChannelId;
}

export interface VoiceChannelKickedEvent {
  channelId: ChannelId;
}

export interface VoiceChannelMovedEvent {
  fromChannelId: ChannelId;
  toChannelId: ChannelId;
}

export interface DirectCallDeclinedEvent {
  channelId: ChannelId;
  byUserId: UserId;
}

/**
 * What one browser in a call tells the others about itself: its `state` (mute,
 * and which streams are its screen and camera). `payload` is a JSON string the
 * hub does not interpret. Descriptions and candidates never travel here; they
 * go to the media server as `MediaSignal`.
 */
export interface VoiceSignal {
  protocolVersion: RtcProtocolVersion;
  channelId: ChannelId;
  /** Set by the server on delivery; omitted when sending. */
  fromUserId?: UserId;
  /** The one person to tell; omit to broadcast to everyone in the channel. */
  toUserId?: UserId;
  kind: RtcSignalKind;
  payload: string;
}

/**
 * One signal between this browser and the media server, relayed by the hub. Like `VoiceSignal`, `payload` is a JSON string the hub
 * does not interpret; `@/lib/rtc/protocol` has a codec for each kind and
 * direction. `K` narrows the kinds: what a browser may send is not what the
 * media server sends.
 */
export interface MediaSignal<K extends MediaSignalKind = MediaSignalKind> {
  protocolVersion: RtcProtocolVersion;
  channelId: ChannelId;
  /** The session `openMediaSession` returned; a signal for another one is stale. */
  sessionId: string;
  kind: K;
  payload: string;
}

/** The media plane ended a session that the seat still needs. */
export interface MediaSessionClosedEvent {
  channelId: ChannelId;
  sessionId: string;
  reason: MediaSessionCloseReason;
}

export interface SoundboardChangedEvent {
  serverId: string;
}

export interface ServerMemberRemovedEvent {
  serverId: string;
  userId: UserId;
}

export interface ServerAccessRevokedEvent {
  serverId: string;
  kind: "kicked" | "banned";
}

export interface PermissionsChangedEvent {
  serverId: string;
  permissions: ServerPermission[];
}

export interface RealtimeEventMap {
  MessageCreated: Message;
  /** A persisted message visible only to the two users of its DM thread. */
  DirectMessageCreated: Message;
  /** The whole message again; `editedAt` is what changed. */
  MessageUpdated: Message;
  /** Ids only: nothing is left of the message to send. */
  MessageDeleted: MessageDeleted;
  /** Arrives after the message, because unfurling is slower than sending. */
  MessageEmbedsUpdated: MessageEmbedsUpdate;
  MessageReactionChanged: MessageReactionChanged;
  TypingChanged: TypingChangedEvent;
  ChannelReadChanged: ChannelReadChanged;
  ServerUpdated: Server;
  PresenceChanged: PresenceChangedEvent;
  /** Public profile fields changed for one server member. */
  UserUpdated: User;
  VoiceParticipantChanged: VoiceParticipantChangedEvent;
  VoiceSessionReplaced: VoiceSessionReplacedEvent;
  VoiceChannelKicked: VoiceChannelKickedEvent;
  VoiceChannelMoved: VoiceChannelMovedEvent;
  DirectCallDeclined: DirectCallDeclinedEvent;
  VoiceSignal: VoiceSignal;
  /** One signal from the media server; only its kinds of signal get through. */
  MediaSignal: MediaSignal<MediaServerSignalKind>;
  MediaSessionClosed: MediaSessionClosedEvent;
  SoundboardPlayed: SoundboardPlayedEvent;
  /**
   * Somebody walked into this voice room and has a clip of their own. Same
   * envelope as a soundboard press, but a separate event: the sound may come
   * from a server the listener is not on, so it announces a person rather than
   * joining that server's board. `triggeredByUserId` is whoever arrived, which
   * is also how the shared chime knows to stay quiet.
   */
  JoinSoundPlayed: SoundboardPlayedEvent;
  SoundboardChanged: SoundboardChangedEvent;
  /** Friends, requests, blocks or direct-message summary state changed. */
  SocialChanged: Record<string, never>;
  /** The signed-in member's effective role changed. */
  PermissionsChanged: PermissionsChangedEvent;
  /** A member disappeared from the shared server roster. */
  ServerMemberRemoved: ServerMemberRemovedEvent;
  /** The signed-in account itself was kicked or banned from the server. */
  ServerAccessRevoked: ServerAccessRevokedEvent;
  /** The server's custom emoji list was uploaded to or pruned. */
  EmojiChanged: Record<string, never>;
  /** A private inbox row was created, read or removed on the active server. */
  NotificationInboxChanged: NotificationInboxChangedEvent;
}

export type RealtimeEventName = keyof RealtimeEventMap;

/**
 * Application events and RTC signaling over one hub, `/hubs/app`.
 *
 * Client events are the keys of `RealtimeEventMap`. Server methods are
 * SetPresence, JoinChannel, SendTyping, JoinVoice, LeaveVoice,
 * DeclineDirectCall, SendVoiceSignal, OpenMediaSession and SendMediaSignal.
 */
export interface RealtimeClient {
  /** Configures the bootstrap-issued hub; call before the first `start()`. */
  configureRtc?(rtc: Pick<RtcConfig, "signalingHub"> | undefined): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): RealtimeStatus;
  subscribeStatus(listener: () => void): () => void;
  on<E extends RealtimeEventName>(
    event: E,
    handler: (payload: RealtimeEventMap[E]) => void,
  ): () => void;
  /** Advertises the signed-in user's chosen status to every client. */
  setPresence(presence: Presence): Promise<void>;
  joinChannel(channelId: ChannelId): Promise<void>;
  sendTyping(channelId: ChannelId): Promise<void>;
  joinVoice(channelId: ChannelId): Promise<void>;
  leaveVoice(): Promise<void>;
  declineDirectCall(conversationId: ChannelId): Promise<void>;
  sendVoiceSignal(signal: VoiceSignal): Promise<void>;
  /**
   * Creates the media session of this connection's seat in `channelId`, which
   * must already be held, and resolves to its id.
   */
  openMediaSession(channelId: ChannelId): Promise<string>;
  sendMediaSignal(signal: MediaSignal<BrowserMediaSignalKind>): Promise<void>;
  playSoundboard(channelId: ChannelId, soundId: SoundboardSound["id"]): Promise<void>;
  getRtcClock(): Promise<number>;
}
