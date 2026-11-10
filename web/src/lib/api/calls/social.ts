import type { SocialApiClient } from "../client";
import { expectRecord, expectString } from "../expect";
import {
  parseDirectMessageHistoryPage,
  parseFriendRequestAnswer,
  parseMessage,
  parseSocialState,
} from "../parsers";
import type { Parse } from "./http";
import { getJson, route, sendJson, sendVoid, withQuery } from "./http";

type SocialCalls = Omit<SocialApiClient, "uploadAttachment">;

const parseConversationId: Parse<string> = (value, path) =>
  expectString(expectRecord(value, path), "id", path);

/** Friends, blocks and the direct conversations between two accounts. */
export function socialCalls(): SocialCalls {
  return {
    getSocialState: (signal) => getJson("/api/social", parseSocialState, signal),

    sendFriendRequest: (username, signal) =>
      sendJson("POST", "/api/social/requests", { username }, parseFriendRequestAnswer, signal),

    acceptFriendRequest: (requestId, signal) =>
      sendVoid("POST", route`/api/social/requests/${requestId}/accept`, undefined, signal),

    deleteFriendRequest: (requestId, signal) =>
      sendVoid("DELETE", route`/api/social/requests/${requestId}`, undefined, signal),

    removeFriend: (userId, signal) =>
      sendVoid("DELETE", route`/api/social/friends/${userId}`, undefined, signal),

    blockUser: (userId, signal) =>
      sendVoid("POST", route`/api/social/blocks/${userId}`, undefined, signal),

    unblockUser: (userId, signal) =>
      sendVoid("DELETE", route`/api/social/blocks/${userId}`, undefined, signal),

    openDirectConversation: (userId, signal) =>
      sendJson("POST", "/api/social/conversations", { userId }, parseConversationId, signal),

    listDirectMessages: (conversationId, options, signal) =>
      getJson(
        withQuery(route`/api/social/conversations/${conversationId}/messages`, {
          cursor: options?.cursor,
          limit: options?.limit,
        }),
        parseDirectMessageHistoryPage,
        signal,
      ),

    sendDirectMessage: (conversationId, content, attachmentIds, clientMessageId, signal) =>
      sendJson(
        "POST",
        route`/api/social/conversations/${conversationId}/messages`,
        { content, attachmentIds, clientMessageId },
        parseMessage,
        signal,
      ),

    markDirectConversationRead: (conversationId, signal) =>
      sendVoid("POST", route`/api/social/conversations/${conversationId}/read`, undefined, signal),
  };
}
