import { describe, expect, it } from "vitest";

import {
  itAnswersMissingDeletes,
  itForwardsTheSignal,
  itSendsCalls,
  jsonResponse,
  mockFetch,
  sentRequest,
} from "@/test/http";

import { messageCalls } from "./messages";

const fetchMock = mockFetch();
const calls = messageCalls();

const MESSAGE = {
  id: "m-1",
  channelId: "c-1",
  author: { id: "u-1", displayName: "Patryk" },
  content: "hej",
  createdAt: "2026-08-10T19:05:00Z",
  attachments: [],
};
const PAGE = { messages: [MESSAGE], nextCursor: null, syncCursor: "7" };

describe("message calls", () => {
  itSendsCalls(fetchMock, [
    {
      name: "listMessages without options",
      run: () => calls.listMessages("c-1"),
      method: "GET",
      url: "/api/channels/c-1/messages",
      answer: PAGE,
    },
    {
      name: "syncMessages with a cursor that needs escaping",
      run: () => calls.syncMessages("a/b", "4 1"),
      method: "GET",
      url: "/api/channels/a%2Fb/messages/sync?after=4%201",
      answer: { changes: [], nextCursor: "41", hasMore: false, resetRequired: false },
    },
    {
      name: "listThreads",
      run: () => calls.listThreads("c-1"),
      method: "GET",
      url: "/api/channels/c-1/threads",
      answer: [
        {
          channelId: "c-1",
          root: { id: "m-1", authorId: "u-1", authorName: "Patryk", preview: "hej", hasAttachment: false },
          replyCount: 2,
          lastReplyAt: "2026-08-10T19:09:00Z",
        },
      ],
    },
    {
      name: "getThread",
      run: () => calls.getThread("c-1", "m/1"),
      method: "GET",
      url: "/api/channels/c-1/threads/m%2F1",
      answer: { messages: [MESSAGE] },
    },
    {
      name: "listIndexedMessages with a query and a page",
      run: () =>
        calls.listIndexedMessages("c-1", { kind: "links", query: "a b", cursor: "x+y", limit: 20 }),
      method: "GET",
      url: "/api/channels/c-1/messages/index?kind=links&query=a+b&cursor=x%2By&limit=20",
      answer: { messages: [MESSAGE], nextCursor: "next" },
    },
    {
      name: "listIndexedMessages with only a kind",
      run: () => calls.listIndexedMessages("c-1", { kind: "media" }),
      method: "GET",
      url: "/api/channels/c-1/messages/index?kind=media",
      answer: { messages: [], nextCursor: null },
    },
    {
      name: "searchMessages with a query that needs escaping",
      run: () => calls.searchMessages("c-1", "kot & pies"),
      method: "GET",
      url: "/api/channels/c-1/messages/search?query=kot%20%26%20pies",
      answer: [MESSAGE],
    },
    {
      name: "sendMessage",
      run: () =>
        calls.sendMessage("c-1", {
          content: "hej",
          attachmentIds: ["a-1"],
          clientMessageId: "cm-1",
        }),
      method: "POST",
      url: "/api/channels/c-1/messages",
      body: { content: "hej", attachmentIds: ["a-1"], clientMessageId: "cm-1" },
      answer: MESSAGE,
    },
    {
      name: "editMessage",
      run: () => calls.editMessage("m-1", "poprawione"),
      method: "PATCH",
      url: "/api/messages/m-1",
      body: { content: "poprawione" },
      answer: { message: { ...MESSAGE, content: "poprawione" } },
    },
    { name: "deleteMessage", run: () => calls.deleteMessage("m-1"), method: "DELETE", url: "/api/messages/m-1" },
    {
      name: "removing a reaction",
      run: () => calls.setMessageReaction("m-1", "👍", false),
      method: "DELETE",
      url: "/api/messages/m-1/reactions/%F0%9F%91%8D",
      answer: { messageId: "m-1", channelId: "c-1", emoji: "👍", count: 0, userId: "u-1", added: false },
    },
    {
      name: "pinning a message",
      run: () => calls.setMessagePinned("m-1", true),
      method: "PUT",
      url: "/api/messages/m-1/pin",
      answer: { ...MESSAGE, pinnedAt: "2026-08-10T19:10:00Z" },
    },
    {
      name: "unpinning a message",
      run: () => calls.setMessagePinned("m-1", false),
      method: "DELETE",
      url: "/api/messages/m-1/pin",
      answer: { message: MESSAGE },
    },
    {
      name: "listPinnedMessages",
      run: () => calls.listPinnedMessages("a/b"),
      method: "GET",
      url: "/api/channels/a%2Fb/pins",
      answer: { messages: [MESSAGE] },
    },
  ]);

  it("asks for the next page with the cursor and the size it was given", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAGE));

    await calls.listMessages("a/b", { cursor: "previous+/=", limit: 25 });

    expect(sentRequest(fetchMock).url).toBe(
      "/api/channels/a%2Fb/messages?cursor=previous%2B%2F%3D&limit=25",
    );
  });

  it("reads an edited message from its envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: { ...MESSAGE, content: "poprawione" } }));
    await expect(calls.editMessage("m-1", "poprawione")).resolves.toMatchObject({
      id: "m-1",
      content: "poprawione",
    });
  });

  it("reads a thread as the root and its replies", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ messages: [MESSAGE, { ...MESSAGE, id: "m-2", content: "odp" }] }),
    );
    await expect(calls.getThread("c-1", "m-1")).resolves.toMatchObject([
      { id: "m-1" },
      { id: "m-2" },
    ]);
  });

  it("rejects a thread answer without its messages", async () => {
    fetchMock.mockResolvedValue(jsonResponse([MESSAGE]));
    await expect(calls.getThread("c-1", "m-1")).rejects.toMatchObject({ kind: "malformed" });
  });

  itAnswersMissingDeletes(fetchMock, { deleteMessage: () => calls.deleteMessage("m-1") }, true);

  itForwardsTheSignal(fetchMock, { deleteMessage: (signal) => calls.deleteMessage("m-1", signal) });

  it("fails a reaction on a message that is gone", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(calls.setMessageReaction("m-1", "👍", true)).rejects.toMatchObject({
      kind: "not-found",
    });
  });

  describe("the pinned list", () => {
    it("is empty on a server that has no pins route", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      await expect(calls.listPinnedMessages("c-1")).resolves.toEqual([]);
    });

    it("still fails on any other refusal", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
      await expect(calls.listPinnedMessages("c-1")).rejects.toMatchObject({ kind: "forbidden" });
    });

    it("rejects an answer that is not a list of messages", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ messages: "none" }));
      await expect(calls.listPinnedMessages("c-1")).rejects.toMatchObject({ kind: "malformed" });
    });
  });

  describe("a refused pin", () => {
    it.each([400, 422])("carries the sentence the server wrote on a %i", async (status) => {
      fetchMock.mockResolvedValue(
        jsonResponse({ title: "pin_limit_reached", detail: "Kanał ma już 50 przypiętych wiadomości." }, status),
      );

      await expect(calls.setMessagePinned("m-1", true)).rejects.toMatchObject({
        kind: "invalid",
        status,
        message: "Kanał ma już 50 przypiętych wiadomości.",
      });
    });

    it("falls back to the status line when the server wrote nothing", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 400 }));

      await expect(calls.setMessagePinned("m-1", true)).rejects.toMatchObject({
        kind: "invalid",
        message: "/api/messages/m-1/pin responded 400",
      });
    });

    it("fails other statuses by kind", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
      await expect(calls.setMessagePinned("m-1", true)).rejects.toMatchObject({ kind: "forbidden" });
    });
  });

  describe("uploads", () => {
    const ATTACHMENT = {
      id: "a-1",
      name: "clip.mp4",
      contentType: "video/mp4",
      size: 10,
      url: "/assets/a-1",
    };

    it("sends only the file when nothing was measured", async () => {
      fetchMock.mockResolvedValue(jsonResponse(ATTACHMENT, 201));

      await calls.uploadAttachment(new File(["x"], "clip.mp4", { type: "video/mp4" }));

      const sent = sentRequest(fetchMock);
      expect([sent.method, sent.url]).toEqual(["POST", "/api/uploads/images"]);
      expect([...(sent.body as FormData).keys()]).toEqual(["file"]);
    });

    it("sends the measured metadata as form fields", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ attachment: ATTACHMENT }, 201));

      await calls.uploadAttachment(new File(["x"], "clip.mp4", { type: "video/mp4" }), {
        durationSeconds: 0,
        width: 1920,
        height: 1080,
        poster: new Blob(["jpg"], { type: "image/jpeg" }),
        voiceMessage: true,
      });

      const form = sentRequest(fetchMock).body as FormData;
      expect([...form.keys()]).toEqual([
        "file",
        "durationSeconds",
        "width",
        "height",
        "poster",
        "voiceMessage",
      ]);
      expect(form.get("durationSeconds")).toBe("0");
      expect(form.get("poster")).toMatchObject({ name: "poster.jpg" });
    });

    it("leaves out the voice flag unless the recording says it is one", async () => {
      fetchMock.mockResolvedValue(jsonResponse(ATTACHMENT, 201));

      await calls.uploadAttachment(new File(["x"], "a.webm"), { voiceMessage: false });

      expect((sentRequest(fetchMock).body as FormData).has("voiceMessage")).toBe(false);
    });

    it("reads the attachment from its envelope", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ attachment: ATTACHMENT }, 201));
      await expect(calls.uploadAttachment(new File(["x"], "clip.mp4"))).resolves.toMatchObject({
        id: "a-1",
        url: "/assets/a-1",
      });
    });

    it("fails an upload the server refuses", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 413 }));
      await expect(calls.uploadAttachment(new File(["x"], "big.bin"))).rejects.toMatchObject({
        status: 413,
      });
    });
  });
});
