import type { Message } from "../types";
import type { ApiClient } from "../client";
import { ApiError } from "../errors";
import { expectArray, expectRecord, unwrap } from "../expect";
import {
  parseAttachment,
  parseChannelRead,
  parseMessage,
  parseMessageHistoryPage,
  parseMessageSyncPage,
  parseReactionChanged,
  parseThreadSummary,
} from "../parsers";
import { fail, problemDetail, readJson, request } from "../transport";
import type { Parse } from "./http";
import {
  ACCEPT_JSON,
  deleteResource,
  fileForm,
  getJson,
  parseList,
  postForm,
  route,
  sendJson,
  withQuery,
} from "./http";

type MessageCalls = Pick<
  ApiClient,
  | "listMessages"
  | "syncMessages"
  | "listThreads"
  | "getThread"
  | "listIndexedMessages"
  | "searchMessages"
  | "sendMessage"
  | "editMessage"
  | "deleteMessage"
  | "setMessageReaction"
  | "markChannelRead"
  | "listPinnedMessages"
  | "setMessagePinned"
  | "uploadAttachment"
>;

/** Endpoints answer with the message itself or with `{ message }`. */
const parseMessageAnswer: Parse<Message> = (value, path) =>
  parseMessage(unwrap(value, "message"), path);

/** Threads and pins answer with `{ messages: [...] }`. */
const parseMessagesField: Parse<Message[]> = (value, path) =>
  expectArray(expectRecord(value, path)["messages"], `${path}.messages`).map((item) =>
    parseMessage(item, `${path}.messages[]`),
  );

const parseThreads = parseList(parseThreadSummary);
const parseMessages = parseList(parseMessage);

/**
 * Every supported image, audio and video type goes through the image route:
 * it is the path older running servers already know, so a deploy that is
 * half rolled out cannot turn an upload into a 404.
 */
const UPLOAD_PATH = "/api/uploads/images";

export function messageCalls(): MessageCalls {
  return {
    listMessages: (channelId, options, signal) =>
      getJson(
        withQuery(route`/api/channels/${channelId}/messages`, {
          cursor: options?.cursor,
          limit: options?.limit,
        }),
        parseMessageHistoryPage,
        signal,
      ),

    syncMessages: (channelId, after, signal) =>
      getJson(
        route`/api/channels/${channelId}/messages/sync?after=${after}`,
        parseMessageSyncPage,
        signal,
      ),

    listThreads: (channelId, signal) =>
      getJson(route`/api/channels/${channelId}/threads`, parseThreads, signal),

    getThread: (channelId, rootId, signal) =>
      getJson(route`/api/channels/${channelId}/threads/${rootId}`, parseMessagesField, signal),

    listIndexedMessages: (channelId, options, signal) =>
      getJson(
        withQuery(route`/api/channels/${channelId}/messages/index`, {
          kind: options.kind,
          query: options.query,
          cursor: options.cursor,
          limit: options.limit,
        }),
        parseMessageHistoryPage,
        signal,
      ),

    searchMessages: (channelId, query, signal) =>
      getJson(
        route`/api/channels/${channelId}/messages/search?query=${query}`,
        parseMessages,
        signal,
      ),

    sendMessage: (channelId, input, signal) =>
      sendJson("POST", route`/api/channels/${channelId}/messages`, input, parseMessageAnswer, signal),

    editMessage: (messageId, content, signal) =>
      sendJson("PATCH", route`/api/messages/${messageId}`, { content }, parseMessageAnswer, signal),

    deleteMessage: (messageId, signal) => deleteResource(route`/api/messages/${messageId}`, signal),

    setMessageReaction: (messageId, emoji, added, signal) =>
      sendJson(
        added ? "PUT" : "DELETE",
        route`/api/messages/${messageId}/reactions/${emoji}`,
        undefined,
        parseReactionChanged,
        signal,
      ),

    markChannelRead: (channelId, signal) =>
      sendJson("PUT", route`/api/channels/${channelId}/read`, undefined, parseChannelRead, signal),

    async listPinnedMessages(channelId, signal) {
      const path = route`/api/channels/${channelId}/pins`;
      const response = await request(path, { method: "GET", headers: ACCEPT_JSON }, signal);
      // A server that predates pinning has no such route. Nothing is pinned
      // there, and an empty list keeps the pin button quiet instead of turning
      // a deploy skew into an error.
      if (response.status === 404) return [];
      if (!response.ok) fail(response, path);
      return parseMessagesField(await readJson(response, path), path);
    },

    async setMessagePinned(messageId, pinned, signal) {
      const path = route`/api/messages/${messageId}/pin`;
      const response = await request(
        path,
        { method: pinned ? "PUT" : "DELETE", headers: ACCEPT_JSON },
        signal,
      );
      // The refusal a reader can act on is the channel's pin ceiling, and the
      // server already words it with the rule and the way out, so that sentence
      // is kept rather than a generic complaint about the request.
      if (response.status === 400 || response.status === 422) {
        throw new ApiError(
          "invalid",
          (await problemDetail(response)) ?? `${path} responded ${response.status}`,
          response.status,
        );
      }
      if (!response.ok) fail(response, path);
      return parseMessageAnswer(await readJson(response, path), path);
    },

    uploadAttachment(file, metadata, signal) {
      const form = fileForm(file);
      if (metadata?.durationSeconds !== undefined) {
        form.append("durationSeconds", String(metadata.durationSeconds));
      }
      if (metadata?.width !== undefined) form.append("width", String(metadata.width));
      if (metadata?.height !== undefined) form.append("height", String(metadata.height));
      if (metadata?.poster !== undefined) form.append("poster", metadata.poster, "poster.jpg");
      if (metadata?.voiceMessage === true) form.append("voiceMessage", "true");
      return postForm(
        UPLOAD_PATH,
        form,
        (value, path) => parseAttachment(unwrap(value, "attachment"), path),
        signal,
      );
    },
  };
}
