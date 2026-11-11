import type { OpusProfileId } from "@/lib/voice/settings";

import type {
  ApiAuditEntry,
  ApiCustomEmoji,
  ApiInvite,
  ApiNotificationSettings,
  PermissionOverride,
} from "./client";
import { parseMessage } from "./chatParsers";
import { parseUser } from "./accountParsers";
import {
  definedField,
  expectArray,
  expectNumber,
  expectRecord,
  expectString,
  isRecord,
  optionalList,
  optionalNumber,
  optionalString,
  stringArray,
} from "./expect";
import { SERVER_PERMISSION_VALUES } from "./types";
import type {
  Bootstrap,
  Channel,
  JoinSoundLibrary,
  RtcConfig,
  Section,
  Server,
  ServerBan,
  ServerMember,
  ServerPermission,
  ServerRole,
  SoundboardSettings,
  SoundboardSnapshot,
  SoundboardSound,
} from "./types";

export function parseServer(value: unknown, path = "server"): Server {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    name: expectString(record, "name", path),
    ...definedField("description", optionalString(record, "description")),
    ...definedField("iconUrl", optionalString(record, "iconUrl")),
    ...definedField("createdAt", optionalString(record, "createdAt")),
    isPublic: record["isPublic"] === true,
  };
}

const AUDIO_PROFILES: readonly OpusProfileId[] = [
  "economy",
  "balanced",
  "clarity",
  "premium",
  "studio",
];

export function parseChannel(value: unknown, path: string): Channel {
  const record = expectRecord(value, path);
  const audioProfile = AUDIO_PROFILES.find(
    (profile) => profile === optionalString(record, "audioProfile"),
  );
  return {
    id: expectString(record, "id", path),
    name: expectString(record, "name", path),
    kind: record["kind"] === "voice" ? "voice" : "text",
    ...definedField("topic", optionalString(record, "topic")),
    ...definedField("slowModeSeconds", optionalNumber(record, "slowModeSeconds")),
    ...definedField(
      "hideAfterInactivityHours",
      optionalNumber(record, "hideAfterInactivityHours"),
    ),
    ...definedField("audioProfile", audioProfile),
    ...definedField("position", optionalNumber(record, "position")),
    ...definedField("userLimit", optionalNumber(record, "userLimit")),
    ...definedField("sectionId", optionalString(record, "sectionId")),
  };
}

export function parseSection(value: unknown, path: string): Section {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    name: expectString(record, "name", path),
    position: optionalNumber(record, "position") ?? 0,
  };
}

/** Known permissions only: a newer server may grant ones this client cannot name. */
function parsePermissions(value: unknown): ServerPermission[] {
  const known: readonly string[] = SERVER_PERMISSION_VALUES;
  return stringArray(value).filter((item): item is ServerPermission => known.includes(item));
}

export function parsePermissionOverride(value: unknown, path: string): PermissionOverride {
  const record = expectRecord(value, path);
  return {
    roleId: expectString(record, "roleId", path),
    allow: parsePermissions(record["allow"]),
    deny: parsePermissions(record["deny"]),
  };
}

export function parseRole(value: unknown, path: string): ServerRole {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    name: expectString(record, "name", path),
    color: expectString(record, "color", path),
    permissions: parsePermissions(record["permissions"]),
    memberCount: optionalNumber(record, "memberCount") ?? 0,
    isSystem: record["isSystem"] === true,
    isOwner: record["isOwner"] === true,
  };
}

export function parseServerMember(value: unknown, path: string): ServerMember {
  const record = expectRecord(value, path);
  return {
    user: parseUser(record["user"], `${path}.user`),
    roleId: expectString(record, "roleId", path),
    joinedAt: expectString(record, "joinedAt", path),
  };
}

export function parseServerBan(value: unknown, path: string): ServerBan {
  const record = expectRecord(value, path);
  return {
    userId: expectString(record, "userId", path),
    displayName: expectString(record, "displayName", path),
    bannedByName: expectString(record, "bannedByName", path),
    reason: expectString(record, "reason", path),
    bannedAt: expectString(record, "bannedAt", path),
  };
}

export function parseInvite(value: unknown, path: string): ApiInvite {
  const record = expectRecord(value, path);
  const maxUses = record["maxUses"];
  const expiresAt = record["expiresAt"];
  return {
    id: expectString(record, "id", path),
    url: expectString(record, "url", path),
    createdByName: expectString(record, "createdByName", path),
    uses: optionalNumber(record, "uses") ?? 0,
    maxUses: typeof maxUses === "number" ? maxUses : null,
    expiresAt: typeof expiresAt === "string" ? expiresAt : null,
  };
}

export function parseAuditEntry(value: unknown, path: string): ApiAuditEntry {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    summary: expectString(record, "summary", path),
    at: expectString(record, "at", path),
  };
}

export function parseCustomEmoji(value: unknown, path: string): ApiCustomEmoji {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    shortcode: expectString(record, "shortcode", path),
    glyph: expectString(record, "glyph", path),
  };
}

export function parseNotificationSettings(
  value: unknown,
  path: string,
): ApiNotificationSettings {
  const record = expectRecord(value, path);
  return {
    allMessages: record["allMessages"] === true,
    mentionsOnly: record["mentionsOnly"] === true,
    voiceJoinSound: record["voiceJoinSound"] === true,
    mutedChannelIds: stringArray(record["mutedChannelIds"]),
    serverMuted: record["serverMuted"] === true,
  };
}

export function parseSoundboardSound(
  value: unknown,
  path = "soundboard sound",
): SoundboardSound {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    name: expectString(record, "name", path),
    glyph: expectString(record, "glyph", path),
    url: expectString(record, "url", path),
    durationSeconds: expectNumber(record, "durationSeconds", path),
    trimStartSeconds: expectNumber(record, "trimStartSeconds", path),
    trimEndSeconds: expectNumber(record, "trimEndSeconds", path),
  };
}

export function parseSoundboardSettings(
  value: unknown,
  path: string,
): SoundboardSettings {
  const record = expectRecord(value, path);
  return {
    everyoneCanPlay: record["everyoneCanPlay"] === true,
    rateLimited: record["rateLimited"] === true,
  };
}

export function parseSoundboardSnapshot(value: unknown, path: string): SoundboardSnapshot {
  const record = expectRecord(value, path);
  return {
    sounds: expectArray(record["sounds"], `${path}.sounds`).map((item) =>
      parseSoundboardSound(item, `${path}.sounds[]`),
    ),
    settings: parseSoundboardSettings(record["settings"], `${path}.settings`),
    canManage: record["canManage"] === true,
  };
}

export function parseJoinSoundLibrary(value: unknown, path: string): JoinSoundLibrary {
  const record = expectRecord(value, path);
  return {
    maxSeconds: optionalNumber(record, "maxSeconds") ?? 5,
    selectedId: optionalString(record, "selectedId") ?? null,
    servers: expectArray(record["servers"], `${path}.servers`).map((item) => {
      const group = expectRecord(item, `${path}.servers[]`);
      return {
        serverId: expectString(group, "serverId", `${path}.servers[]`),
        serverName: expectString(group, "serverName", `${path}.servers[]`),
        ...definedField("iconUrl", optionalString(group, "iconUrl")),
        sounds: expectArray(group["sounds"], `${path}.servers[].sounds`).map((sound) =>
          parseSoundboardSound(sound, `${path}.servers[].sounds[]`),
        ),
      };
    }),
  };
}

/**
 * The RTC contract the server issued, or undefined when it sent none.
 *
 * A missing or malformed protocol version reads as 0, which is deliberately
 * incompatible with every protocol this client speaks: quietly reading a
 * contract it does not understand as v1 would open capture on a protocol it
 * cannot actually run.
 */
function parseRtc(value: unknown): RtcConfig | undefined {
  if (!isRecord(value)) return undefined;
  const capabilities = isRecord(value["capabilities"]) ? value["capabilities"] : {};
  const iceServers = Array.isArray(value["iceServers"]) ? value["iceServers"] : [];
  return {
    protocolVersion: optionalNumber(value, "protocolVersion") ?? 0,
    capabilities: {
      audioCodecs: stringArray(capabilities["audioCodecs"]),
      videoCodecs: stringArray(capabilities["videoCodecs"]),
      audioProcessing: stringArray(capabilities["audioProcessing"]),
      camera: capabilities["camera"] === true,
      screenShare: capabilities["screenShare"] === true,
      screenAudio: capabilities["screenAudio"] === true,
    },
    signalingHub: optionalString(value, "signalingHub") ?? "/hubs/app",
    mediaServer: optionalString(value, "mediaServer") ?? "",
    iceServers: iceServers.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const urls =
        typeof entry["urls"] === "string" ? [entry["urls"]] : stringArray(entry["urls"]);
      if (urls.length === 0) return [];
      const username = optionalString(entry, "username");
      const credential = optionalString(entry, "credential");
      return [
        {
          urls,
          ...(username ? { username } : {}),
          ...(credential ? { credential } : {}),
        },
      ];
    }),
  };
}

export function parseBootstrap(value: unknown, path = "/api/bootstrap"): Bootstrap {
  const record = expectRecord(value, path);
  const server = parseServer(record["server"], `${path}.server`);
  const channelReads = record["channelReads"];
  const voice = record["voice"];
  const rtc = parseRtc(record["rtc"]);
  return {
    user: parseUser(record["user"], `${path}.user`),
    server,
    servers: Array.isArray(record["servers"])
      ? record["servers"].map((item) => parseServer(item, `${path}.servers[]`))
      : [server],
    channels: expectArray(record["channels"], `${path}.channels`)
      .map((item) => parseChannel(item, `${path}.channels[]`))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    sections: expectArray(record["sections"], `${path}.sections`)
      .map((item) => parseSection(item, `${path}.sections[]`))
      .sort((a, b) => a.position - b.position),
    members: expectArray(record["members"], `${path}.members`).map((item) =>
      parseUser(item, `${path}.members[]`),
    ),
    permissions: parsePermissions(record["permissions"]),
    messages: optionalList(record["messages"], `${path}.messages[]`, parseMessage),
    ...(isRecord(channelReads)
      ? {
          channelReads: Object.fromEntries(
            Object.entries(channelReads).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
        }
      : {}),
    ...(isRecord(voice) ? { voice: voice as Bootstrap["voice"] } : {}),
    ...(rtc === undefined ? {} : { rtc }),
  };
}
