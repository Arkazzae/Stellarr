import {
  parseChannelRead,
  parseEmbedsUpdate,
  parseMessage,
  parseReactionChanged,
  parseServer,
  parseSoundboardSound,
  parseUser,
} from "@/lib/api/client";
import { isRecord } from "@/lib/api/expect";
import { isPresence, SERVER_PERMISSION_VALUES } from "@/lib/api/types";
import type { ServerPermission } from "@/lib/api/types";
import {
  isRtcSignalKind,
  RTC_HUB,
  RTC_PROTOCOL_VERSION,
} from "@/lib/rtc/protocol";
import type { RealtimeEventMap, RealtimeEventName, VoiceSignal } from "./types";

/**
 * Turns the untrusted argument of one hub event into its typed payload, or
 * `null` when it is malformed. A bad event is dropped here and never reaches
 * the socket or the subscribers.
 */
export type HubDecoder<E extends RealtimeEventName> = (
  payload: unknown,
) => RealtimeEventMap[E] | null;

/** Adapts a throwing wire parser from `@/lib/api/client` to the decoder contract. */
function parsed<T>(parse: (payload: unknown) => T) {
  return (payload: unknown): T | null => {
    try {
      return parse(payload);
    } catch {
      return null;
    }
  };
}

/** An event whose payload is a record of required string fields and nothing else. */
function strings<K extends string>(...keys: K[]) {
  return (payload: unknown): Record<K, string> | null => {
    if (!isRecord(payload)) return null;
    const picked: Partial<Record<K, string>> = {};
    for (const key of keys) {
      const value = payload[key];
      if (typeof value !== "string") return null;
      picked[key] = value;
    }
    return picked as Record<K, string>;
  };
}

/** A sequence is a positive safe integer; anything else is a protocol violation. */
const isSequence = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

const PERMISSIONS: ReadonlySet<unknown> = new Set(SERVER_PERMISSION_VALUES);

const decodePresence: HubDecoder<"PresenceChanged"> = (payload) => {
  if (!isRecord(payload)) return null;
  const { userId, presence } = payload;
  return typeof userId === "string" && isPresence(presence)
    ? { userId, presence }
    : null;
};

const decodePermissions: HubDecoder<"PermissionsChanged"> = (payload) => {
  if (!isRecord(payload)) return null;
  const { serverId, permissions } = payload;
  if (typeof serverId !== "string" || !Array.isArray(permissions)) return null;
  return {
    serverId,
    permissions: permissions.filter((item): item is ServerPermission =>
      PERMISSIONS.has(item),
    ),
  };
};

const decodeAccessRevoked: HubDecoder<"ServerAccessRevoked"> = (payload) => {
  if (!isRecord(payload)) return null;
  const { serverId, kind } = payload;
  return typeof serverId === "string" && (kind === "kicked" || kind === "banned")
    ? { serverId, kind }
    : null;
};

const decodeInboxChanged: HubDecoder<"NotificationInboxChanged"> = (payload) => {
  if (!isRecord(payload)) return null;
  const { serverId, sequence, global } = payload;
  if (typeof serverId !== "string") return null;
  // The server sends `sequence: null` for a change that has no row to point at.
  if (sequence !== null && sequence !== undefined && !isSequence(sequence)) return null;
  if (global !== undefined && typeof global !== "boolean") return null;
  return {
    serverId,
    ...(typeof sequence === "number" ? { sequence } : {}),
    ...(global === true ? { global } : {}),
  };
};

const decodeVoiceParticipants: HubDecoder<"VoiceParticipantChanged"> = (payload) => {
  if (!isRecord(payload)) return null;
  const { channelId, sequence, participants } = payload;
  if (typeof channelId !== "string" || !Array.isArray(participants)) return null;
  if (sequence !== undefined && !isSequence(sequence)) return null;
  return {
    channelId,
    ...(typeof sequence === "number" ? { sequence } : {}),
    participants: participants.flatMap((item) => {
      if (!isRecord(item)) return [];
      const { userId, displayName, muted } = item;
      if (typeof userId !== "string") return [];
      return [
        {
          userId,
          displayName: typeof displayName === "string" ? displayName : userId,
          muted: muted === true,
        },
      ];
    }),
  };
};

export function parseVoiceSignal(payload: unknown): VoiceSignal | null {
  if (!isRecord(payload)) return null;
  const { protocolVersion, channelId, kind, fromUserId, toUserId } = payload;
  const body = payload["payload"];
  if (protocolVersion !== RTC_PROTOCOL_VERSION) return null;
  if (typeof channelId !== "string" || typeof body !== "string") return null;
  if (!isRtcSignalKind(kind)) return null;
  return {
    protocolVersion,
    channelId,
    kind,
    payload: body,
    ...(typeof fromUserId === "string" ? { fromUserId } : {}),
    ...(typeof toUserId === "string" ? { toUserId } : {}),
  };
}

export function parseSoundboardPlayed(
  payload: unknown,
): RealtimeEventMap["SoundboardPlayed"] | null {
  if (!isRecord(payload)) return null;
  const { playbackId, channelId, triggeredByUserId, startsAtUnixMs } = payload;
  if (
    typeof playbackId !== "string" ||
    typeof channelId !== "string" ||
    typeof triggeredByUserId !== "string" ||
    typeof startsAtUnixMs !== "number" ||
    !Number.isFinite(startsAtUnixMs)
  ) {
    return null;
  }
  try {
    const sound = parseSoundboardSound(payload["sound"], "SoundboardPlayed.sound");
    return { playbackId, channelId, triggeredByUserId, startsAtUnixMs, sound };
  } catch {
    return null;
  }
}

/**
 * One decoder per hub event. The hub names its events exactly like
 * `RealtimeEventMap`, so the keys are both the wire names and the names
 * subscribers listen for.
 */
export const HUB_DECODERS: { [E in RealtimeEventName]: HubDecoder<E> } = {
  MessageCreated: parsed(parseMessage),
  DirectMessageCreated: parsed(parseMessage),
  MessageUpdated: parsed(parseMessage),
  MessageDeleted: strings("messageId", "channelId"),
  MessageEmbedsUpdated: parsed(parseEmbedsUpdate),
  MessageReactionChanged: parsed(parseReactionChanged),
  TypingChanged: strings("channelId", "userId", "displayName", "expiresAt"),
  ChannelReadChanged: parsed(parseChannelRead),
  ServerUpdated: parsed(parseServer),
  PresenceChanged: decodePresence,
  UserUpdated: parsed((payload) => parseUser(payload, "UserUpdated")),
  SocialChanged: () => ({}),
  PermissionsChanged: decodePermissions,
  ServerMemberRemoved: strings("serverId", "userId"),
  ServerAccessRevoked: decodeAccessRevoked,
  EmojiChanged: () => ({}),
  NotificationInboxChanged: decodeInboxChanged,
  [RTC_HUB.events.participants]: decodeVoiceParticipants,
  [RTC_HUB.events.sessionReplaced]: strings("channelId"),
  VoiceChannelKicked: strings("channelId"),
  VoiceChannelMoved: strings("fromChannelId", "toChannelId"),
  [RTC_HUB.events.directCallDeclined]: strings("channelId", "byUserId"),
  [RTC_HUB.events.signal]: parseVoiceSignal,
  [RTC_HUB.events.soundboardPlayed]: parseSoundboardPlayed,
  [RTC_HUB.events.joinSoundPlayed]: parseSoundboardPlayed,
  [RTC_HUB.events.soundboardChanged]: strings("serverId"),
};
