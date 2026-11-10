import { describe, expect, it } from "vitest";

import {
  itAnswersMissingDeletes,
  itForwardsTheSignal,
  itSendsCalls,
  jsonResponse,
  mockFetch,
  sentRequest,
} from "@/test/http";

import { socialCalls } from "./social";

const fetchMock = mockFetch();
const calls = socialCalls();

const MESSAGE = {
  id: "m-1",
  channelId: "dm-1",
  author: { id: "u-1", displayName: "Patryk" },
  content: "hej",
  createdAt: "2026-08-10T19:05:00Z",
  attachments: [],
};

describe("social calls", () => {
  itSendsCalls(fetchMock, [
    {
      name: "getSocialState",
      run: () => calls.getSocialState(),
      method: "GET",
      url: "/api/social",
      answer: { friends: [], requests: [], blocked: [], conversations: [] },
    },
    {
      name: "sendFriendRequest",
      run: () => calls.sendFriendRequest("ada"),
      method: "POST",
      url: "/api/social/requests",
      body: { username: "ada" },
      answer: { result: "sent" },
    },
    {
      name: "acceptFriendRequest",
      run: () => calls.acceptFriendRequest("r/1"),
      method: "POST",
      url: "/api/social/requests/r%2F1/accept",
    },
    {
      name: "deleteFriendRequest",
      run: () => calls.deleteFriendRequest("r-1"),
      method: "DELETE",
      url: "/api/social/requests/r-1",
    },
    { name: "removeFriend", run: () => calls.removeFriend("u-2"), method: "DELETE", url: "/api/social/friends/u-2" },
    { name: "blockUser", run: () => calls.blockUser("u-2"), method: "POST", url: "/api/social/blocks/u-2" },
    { name: "unblockUser", run: () => calls.unblockUser("u-2"), method: "DELETE", url: "/api/social/blocks/u-2" },
    {
      name: "openDirectConversation",
      run: () => calls.openDirectConversation("u-2"),
      method: "POST",
      url: "/api/social/conversations",
      body: { userId: "u-2" },
      answer: { id: "dm-1" },
    },
    {
      name: "listDirectMessages without options",
      run: () => calls.listDirectMessages("dm-1"),
      method: "GET",
      url: "/api/social/conversations/dm-1/messages",
      answer: { messages: [MESSAGE], nextCursor: null },
    },
    {
      name: "listDirectMessages with a page",
      run: () => calls.listDirectMessages("dm/1", { cursor: "a+b", limit: 40 }),
      method: "GET",
      url: "/api/social/conversations/dm%2F1/messages?cursor=a%2Bb&limit=40",
      answer: { messages: [], nextCursor: "next" },
    },
    {
      name: "sendDirectMessage",
      run: () => calls.sendDirectMessage("dm-1", "hej", ["a-1"], "cm-1"),
      method: "POST",
      url: "/api/social/conversations/dm-1/messages",
      body: { content: "hej", attachmentIds: ["a-1"], clientMessageId: "cm-1" },
      answer: MESSAGE,
    },
    {
      name: "markDirectConversationRead",
      run: () => calls.markDirectConversationRead("dm-1"),
      method: "POST",
      url: "/api/social/conversations/dm-1/read",
    },
  ]);

  it("answers the friend request with what the server decided", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: "already-friends" }));
    await expect(calls.sendFriendRequest("ada")).resolves.toBe("already-friends");
  });

  it("sends a direct message without the optional parts", async () => {
    fetchMock.mockResolvedValue(jsonResponse(MESSAGE, 201));

    await expect(calls.sendDirectMessage("dm-1", "hej")).resolves.toMatchObject({ id: "m-1" });

    expect(sentRequest(fetchMock).body).toEqual({ content: "hej" });
  });

  it("rejects a conversation answer without an id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(calls.openDirectConversation("u-2")).rejects.toMatchObject({ kind: "malformed" });
  });

  it("rejects a page whose cursor is neither text nor null", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [], nextCursor: 5 }));
    await expect(calls.listDirectMessages("dm-1")).rejects.toMatchObject({ kind: "malformed" });
  });

  describe("a target that is already gone", () => {
    itAnswersMissingDeletes(
      fetchMock,
      {
        deleteFriendRequest: () => calls.deleteFriendRequest("r-1"),
        removeFriend: () => calls.removeFriend("u-2"),
        unblockUser: () => calls.unblockUser("u-2"),
      },
      false,
    );
  });

  itForwardsTheSignal(fetchMock, {
    acceptFriendRequest: (signal) => calls.acceptFriendRequest("r-1", signal),
    deleteFriendRequest: (signal) => calls.deleteFriendRequest("r-1", signal),
    removeFriend: (signal) => calls.removeFriend("u-2", signal),
    blockUser: (signal) => calls.blockUser("u-2", signal),
    unblockUser: (signal) => calls.unblockUser("u-2", signal),
    markDirectConversationRead: (signal) => calls.markDirectConversationRead("dm-1", signal),
  });
});
