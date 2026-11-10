import { ApiError } from "./errors";
import {
  definedField,
  expectArray,
  expectBoolean,
  expectNumber,
  expectRecord,
  expectSafeInteger,
  expectString,
  isRecord,
  optionalList,
  optionalNumber,
  optionalString,
} from "./expect";
import type {
  InboxNotification,
  NotificationPage,
  NotificationTone,
} from "@/ports/notifications";

import type {
  Attachment,
  ChannelReadChanged,
  DirectMessageHistoryPage,
  Message,
  MessageEmbed,
  MessageEmbedsUpdate,
  MessageHistoryPage,
  MessageReaction,
  MessageReactionChanged,
  MessageReference,
  MessageSyncChange,
  MessageSyncPage,
  ThreadSummary,
} from "./types";

export function parseAttachment(value: unknown, path: string): Attachment {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    url: expectString(record, "url", path),
    name: optionalString(record, "name") ?? "attachment",
    contentType: optionalString(record, "contentType") ?? "application/octet-stream",
    size: optionalNumber(record, "size") ?? 0,
    ...definedField("width", optionalNumber(record, "width")),
    ...definedField("height", optionalNumber(record, "height")),
    ...definedField("durationSeconds", optionalNumber(record, "durationSeconds")),
    ...definedField("posterUrl", optionalString(record, "posterUrl")),
    ...(record["isVoiceMessage"] === true ? { isVoiceMessage: true } : {}),
  };
}

function parseEmbed(value: unknown, path: string): MessageEmbed {
  const record = expectRecord(value, path);
  return {
    id: expectString(record, "id", path),
    url: expectString(record, "url", path),
    kind: record["kind"] === "video" ? "video" : "link",
    provider: optionalString(record, "provider") ?? "",
    domain: optionalString(record, "domain") ?? "",
    ...definedField("providerId", optionalString(record, "providerId")),
    ...definedField("startSeconds", optionalNumber(record, "startSeconds")),
    ...definedField("title", optionalString(record, "title")),
    ...definedField("description", optionalString(record, "description")),
    ...definedField("thumbnailUrl", optionalString(record, "thumbnailUrl")),
  };
}

export function parseEmbedsUpdate(
  value: unknown,
  path = "embedsUpdate",
): MessageEmbedsUpdate {
  const record = expectRecord(value, path);
  return {
    messageId: expectString(record, "messageId", path),
    channelId: expectString(record, "channelId", path),
    embeds: optionalList(record["embeds"], `${path}.embeds[]`, parseEmbed),
  };
}

/**
 * The message a reply answers, when the server names one.
 *
 * Optional at every level: a build that has never heard of replies omits the
 * field, and a reference without an id is not a reference.
 */
function parseReference(value: unknown): MessageReference | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalString(value, "id");
  if (id === undefined) return undefined;
  const hasAttachment = value["hasAttachment"];
  return {
    id,
    authorId: optionalString(value, "authorId") ?? "",
    authorName: optionalString(value, "authorName") ?? "",
    preview: optionalString(value, "preview") ?? "",
    ...(typeof hasAttachment === "boolean" ? { hasAttachment } : {}),
  };
}

function parseReaction(value: unknown, path: string): MessageReaction {
  const record = expectRecord(value, path);
  return {
    emoji: expectString(record, "emoji", path),
    count: expectNumber(record, "count", path),
    mine: record["mine"] === true,
  };
}

export function parseReactionChanged(
  value: unknown,
  path = "reactionChanged",
): MessageReactionChanged {
  const record = expectRecord(value, path);
  return {
    messageId: expectString(record, "messageId", path),
    channelId: expectString(record, "channelId", path),
    emoji: expectString(record, "emoji", path),
    count: expectNumber(record, "count", path),
    userId: expectString(record, "userId", path),
    added: record["added"] === true,
  };
}

export function parseMessage(value: unknown, path = "message"): Message {
  const record = expectRecord(value, path);
  const author = expectRecord(record["author"], `${path}.author`);
  const authorId = expectString(author, "id", `${path}.author`);
  const replyTo = parseReference(record["replyTo"]);
  return {
    id: expectString(record, "id", path),
    channelId: expectString(record, "channelId", path),
    author: { id: authorId, displayName: optionalString(author, "displayName") ?? authorId },
    content: optionalString(record, "content") ?? "",
    attachments: optionalList(record["attachments"], `${path}.attachments[]`, parseAttachment),
    // Absent on a server that predates unfurling, and on every message without
    // links, so an empty list is the normal case.
    embeds: optionalList(record["embeds"], `${path}.embeds[]`, parseEmbed),
    reactions: optionalList(record["reactions"], `${path}.reactions[]`, parseReaction),
    createdAt: optionalString(record, "createdAt") ?? new Date(0).toISOString(),
    ...(replyTo === undefined ? {} : { replyTo }),
    // Absent on servers that predate editing and pinning, and on the great
    // majority of messages, which were never edited or pinned.
    ...definedField("editedAt", optionalString(record, "editedAt")),
    ...definedField("pinnedAt", optionalString(record, "pinnedAt")),
  };
}

function parseNextCursor(record: Record<string, unknown>, path: string): string | null {
  const nextCursor = record["nextCursor"];
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new ApiError("malformed", `${path}: "nextCursor" must be a string or null`);
  }
  return nextCursor;
}

export function parseMessageHistoryPage(
  value: unknown,
  path = "messageHistory",
): MessageHistoryPage {
  const record = expectRecord(value, path);
  return {
    messages: expectArray(record["messages"], `${path}.messages`).map((item) =>
      parseMessage(item, `${path}.messages[]`),
    ),
    nextCursor: parseNextCursor(record, path),
    syncCursor: optionalString(record, "syncCursor") ?? "0",
  };
}

export function parseDirectMessageHistoryPage(
  value: unknown,
  path = "directMessageHistory",
): DirectMessageHistoryPage {
  const record = expectRecord(value, path);
  return {
    messages: expectArray(record["messages"], `${path}.messages`).map((item) =>
      parseMessage(item, `${path}.messages[]`),
    ),
    nextCursor: parseNextCursor(record, path),
  };
}

function parseSyncChange(value: unknown, path: string): MessageSyncChange {
  const change = expectRecord(value, path);
  const kind = expectString(change, "kind", path);
  if (kind !== "upsert" && kind !== "delete") {
    throw new ApiError("malformed", `${path}: unknown message change kind`);
  }
  const message = change["message"];
  return {
    cursor: expectString(change, "cursor", path),
    kind,
    messageId: expectString(change, "messageId", path),
    ...(message === null || message === undefined
      ? {}
      : { message: parseMessage(message, `${path}.message`) }),
  };
}

export function parseMessageSyncPage(
  value: unknown,
  path = "messageSync",
): MessageSyncPage {
  const record = expectRecord(value, path);
  return {
    changes: expectArray(record["changes"], `${path}.changes`).map((item) =>
      parseSyncChange(item, `${path}.changes[]`),
    ),
    nextCursor: expectString(record, "nextCursor", path),
    hasMore: expectBoolean(record, "hasMore", path),
    resetRequired: expectBoolean(record, "resetRequired", path),
  };
}

export function parseThreadSummary(
  value: unknown,
  path = "threadSummary",
): ThreadSummary {
  const record = expectRecord(value, path);
  const root = parseReference(record["root"]);
  if (root === undefined) {
    throw new ApiError("malformed", `${path}: "root" must be a message reference`);
  }
  return {
    channelId: expectString(record, "channelId", path),
    root,
    replyCount: expectNumber(record, "replyCount", path),
    lastReplyAt: expectString(record, "lastReplyAt", path),
  };
}

export function parseChannelRead(
  value: unknown,
  path = "channelRead",
): ChannelReadChanged {
  const record = expectRecord(value, path);
  return {
    channelId: expectString(record, "channelId", path),
    lastReadAt: expectString(record, "lastReadAt", path),
  };
}

const NOTIFICATION_TONES: ReadonlySet<string> = new Set<NotificationTone>([
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
]);

function isNotificationTone(value: string): value is NotificationTone {
  return NOTIFICATION_TONES.has(value);
}

function parseNotificationTarget(
  value: unknown,
  path: string,
): InboxNotification["target"] {
  if (value === null || value === undefined) return undefined;
  const record = expectRecord(value, path);
  switch (expectString(record, "type", path)) {
    case "channel":
      return { type: "channel", channelId: expectString(record, "channelId", path) };
    case "server-invite":
      return {
        type: "server-invite",
        inviteCode: expectString(record, "inviteCode", path),
        serverId: expectString(record, "serverId", path),
        serverName: expectString(record, "serverName", path),
        invitedByName: expectString(record, "invitedByName", path),
      };
    default:
      throw new ApiError("malformed", `${path}: "type" is not supported`);
  }
}

export function parseInboxNotification(value: unknown, path: string): InboxNotification {
  const record = expectRecord(value, path);
  const tone = expectString(record, "tone", path);
  if (!isNotificationTone(tone)) {
    throw new ApiError("malformed", `${path}: "tone" is not supported`);
  }

  const sourcePath = `${path}.source`;
  const source = expectRecord(record["source"], sourcePath);
  const sourceType = expectString(source, "type", sourcePath);
  if (sourceType !== "sdk" && sourceType !== "system") {
    throw new ApiError("malformed", `${sourcePath}: "type" is not supported`);
  }

  const readAt = record["readAt"];
  if (readAt !== null && readAt !== undefined && typeof readAt !== "string") {
    throw new ApiError("malformed", `${path}: "readAt" must be a string or null`);
  }
  const target = parseNotificationTarget(record["target"], `${path}.target`);

  return {
    id: expectString(record, "id", path),
    sequence: expectSafeInteger(record, "sequence", path, 1),
    title: expectString(record, "title", path),
    body: expectString(record, "body", path),
    tone,
    source: {
      type: sourceType,
      packageId: expectString(source, "packageId", sourcePath),
      packageName: expectString(source, "packageName", sourcePath),
      moduleId: expectString(source, "moduleId", sourcePath),
      moduleName: expectString(source, "moduleName", sourcePath),
    },
    ...(target === undefined ? {} : { target }),
    createdAt: expectString(record, "createdAt", path),
    ...(typeof readAt === "string" ? { readAt } : {}),
  };
}

export function parseNotificationPage(value: unknown, path: string): NotificationPage {
  const record = expectRecord(value, path);
  const next = record["nextBeforeSequence"];
  if (next !== null && (typeof next !== "number" || !Number.isSafeInteger(next) || next < 1)) {
    throw new ApiError(
      "malformed",
      `${path}: "nextBeforeSequence" must be a positive safe integer or null`,
    );
  }
  return {
    items: expectArray(record["items"], `${path}.items`).map((item, index) =>
      parseInboxNotification(item, `${path}.items[${index}]`),
    ),
    nextBeforeSequence: next,
    unreadCount: expectSafeInteger(record, "unreadCount", path),
    lastSequence: expectSafeInteger(record, "lastSequence", path),
  };
}
