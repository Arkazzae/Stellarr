import { describe, expect, it } from "vitest";

import {
  parseAttachment,
  parseChannelRead,
  parseDirectMessageHistoryPage,
  parseEmbedsUpdate,
  parseInboxNotification,
  parseMessage,
  parseMessageHistoryPage,
  parseMessageSyncPage,
  parseNotificationPage,
  parseReactionChanged,
  parseThreadSummary,
} from "./parsers";

function expectMalformed(action: () => unknown): void {
  expect(action).toThrow(expect.objectContaining({ name: "ApiError", kind: "malformed" }));
}

const MESSAGE = {
  id: "m-1",
  channelId: "c-1",
  author: { id: "u-1", displayName: "Maja" },
  content: "Cześć",
  createdAt: "2026-01-01T19:00:00Z",
};

describe("parseMessage", () => {
  it("reads a minimal message and fills in the lists older servers omit", () => {
    expect(parseMessage(MESSAGE)).toStrictEqual({
      ...MESSAGE,
      attachments: [],
      embeds: [],
      reactions: [],
    });
  });

  it("falls back for the text fields a server may leave out", () => {
    const message = parseMessage({
      id: "m-1",
      channelId: "c-1",
      author: { id: "u-1" },
    });

    expect(message.author.displayName).toBe("u-1");
    expect(message.content).toBe("");
    expect(message.createdAt).toBe(new Date(0).toISOString());
  });

  it("keeps edit and pin timestamps only when the server sent them", () => {
    const plain = parseMessage(MESSAGE);
    expect("editedAt" in plain).toBe(false);
    expect("pinnedAt" in plain).toBe(false);

    const marked = parseMessage({
      ...MESSAGE,
      editedAt: "2026-01-01T19:05:00Z",
      pinnedAt: "2026-01-01T19:10:00Z",
    });
    expect(marked.editedAt).toBe("2026-01-01T19:05:00Z");
    expect(marked.pinnedAt).toBe("2026-01-01T19:10:00Z");
  });

  it("reads the message a reply answers", () => {
    const message = parseMessage({
      ...MESSAGE,
      replyTo: { id: "m-0", authorId: "u-2", authorName: "Olek", preview: "Hej", hasAttachment: true },
    });

    expect(message.replyTo).toStrictEqual({
      id: "m-0",
      authorId: "u-2",
      authorName: "Olek",
      preview: "Hej",
      hasAttachment: true,
    });
  });

  it("drops a reply reference that names no message", () => {
    expect(parseMessage({ ...MESSAGE, replyTo: { preview: "Hej" } }).replyTo).toBeUndefined();
    expect(parseMessage({ ...MESSAGE, replyTo: "m-0" }).replyTo).toBeUndefined();
  });

  it("reads reactions from the viewer's point of view", () => {
    const message = parseMessage({
      ...MESSAGE,
      reactions: [
        { emoji: "👍", count: 2, mine: true },
        { emoji: "🎉", count: 1 },
      ],
    });

    expect(message.reactions).toStrictEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "🎉", count: 1, mine: false },
    ]);
  });

  it("reads link cards, defaulting anything but a video to a link", () => {
    const message = parseMessage({
      ...MESSAGE,
      embeds: [
        { id: "e-1", url: "https://example.com", kind: "article", domain: "example.com", title: "Tytuł" },
        { id: "e-2", url: "https://youtu.be/x", kind: "video", provider: "youtube", providerId: "x", startSeconds: 30 },
      ],
    });

    expect(message.embeds).toStrictEqual([
      { id: "e-1", url: "https://example.com", kind: "link", provider: "", domain: "example.com", title: "Tytuł" },
      {
        id: "e-2",
        url: "https://youtu.be/x",
        kind: "video",
        provider: "youtube",
        domain: "",
        providerId: "x",
        startSeconds: 30,
      },
    ]);
  });

  it("treats a list of the wrong type as empty", () => {
    const message = parseMessage({ ...MESSAGE, attachments: null, embeds: "none", reactions: {} });

    expect(message.attachments).toEqual([]);
    expect(message.embeds).toEqual([]);
    expect(message.reactions).toEqual([]);
  });

  it("rejects what cannot be a message", () => {
    expectMalformed(() => parseMessage(null));
    expectMalformed(() => parseMessage({ ...MESSAGE, id: 7 }));
    expectMalformed(() => parseMessage({ ...MESSAGE, channelId: undefined }));
    expectMalformed(() => parseMessage({ ...MESSAGE, author: "u-1" }));
    expectMalformed(() => parseMessage({ ...MESSAGE, author: {} }));
  });

  it("rejects a malformed item inside a list, naming where it was", () => {
    expectMalformed(() => parseMessage({ ...MESSAGE, attachments: [{ id: "a-1" }] }));
    expectMalformed(() => parseMessage({ ...MESSAGE, reactions: [{ emoji: "👍" }] }));
    expect(() => parseMessage({ ...MESSAGE, embeds: [{ id: "e" }] }, "/api/x")).toThrow(
      /\/api\/x\.embeds\[\]/,
    );
  });
});

describe("parseAttachment", () => {
  it("falls back to a generic name, type and size", () => {
    expect(parseAttachment({ id: "a-1", url: "/assets/a-1" }, "/p")).toStrictEqual({
      id: "a-1",
      url: "/assets/a-1",
      name: "attachment",
      contentType: "application/octet-stream",
      size: 0,
    });
  });

  it("carries measured media metadata and the voice-message mark", () => {
    const attachment = parseAttachment(
      {
        id: "a-1",
        url: "/assets/a-1",
        name: "klip.webm",
        contentType: "video/webm",
        size: 2048,
        width: 640,
        height: 360,
        durationSeconds: 12.5,
        posterUrl: "/assets/a-1-poster",
        isVoiceMessage: true,
      },
      "/p",
    );

    expect(attachment).toMatchObject({
      width: 640,
      height: 360,
      durationSeconds: 12.5,
      posterUrl: "/assets/a-1-poster",
      isVoiceMessage: true,
    });
  });

  it("leaves absent metadata absent, and a false voice mark out", () => {
    const attachment = parseAttachment({ id: "a-1", url: "/u", isVoiceMessage: false }, "/p");

    expect(Object.keys(attachment).sort()).toEqual(["contentType", "id", "name", "size", "url"]);
  });

  it("requires an id and a url", () => {
    expectMalformed(() => parseAttachment({ url: "/u" }, "/p"));
    expectMalformed(() => parseAttachment({ id: "a-1" }, "/p"));
  });
});

describe("parseMessageHistoryPage", () => {
  it("reads a page with its cursors", () => {
    const page = parseMessageHistoryPage({
      messages: [MESSAGE],
      nextCursor: "cur-1",
      syncCursor: "42",
    });

    expect(page.messages).toHaveLength(1);
    expect(page.nextCursor).toBe("cur-1");
    expect(page.syncCursor).toBe("42");
  });

  it("accepts null at the start of the channel and defaults the sync cursor", () => {
    const page = parseMessageHistoryPage({ messages: [], nextCursor: null });

    expect(page.nextCursor).toBeNull();
    expect(page.syncCursor).toBe("0");
  });

  it("insists that nextCursor is present", () => {
    expectMalformed(() => parseMessageHistoryPage({ messages: [] }));
    expectMalformed(() => parseMessageHistoryPage({ messages: [], nextCursor: 3 }));
  });

  it("insists on a list of messages", () => {
    expectMalformed(() => parseMessageHistoryPage({ nextCursor: null }));
    expectMalformed(() => parseMessageHistoryPage({ messages: [{}], nextCursor: null }));
  });
});

describe("parseDirectMessageHistoryPage", () => {
  it("reads a page without a sync cursor", () => {
    expect(
      parseDirectMessageHistoryPage({ messages: [MESSAGE], nextCursor: null }),
    ).toStrictEqual({ messages: [parseMessage(MESSAGE)], nextCursor: null });
  });

  it("insists that nextCursor is a string or null", () => {
    expectMalformed(() => parseDirectMessageHistoryPage({ messages: [] }));
    expectMalformed(() => parseDirectMessageHistoryPage({ messages: [], nextCursor: 1 }));
  });
});

describe("parseMessageSyncPage", () => {
  const page = { changes: [], nextCursor: "9", hasMore: false, resetRequired: false };

  it("reads upserts with their message and deletes without one", () => {
    const parsed = parseMessageSyncPage({
      ...page,
      changes: [
        { cursor: "7", kind: "upsert", messageId: "m-1", message: MESSAGE },
        { cursor: "8", kind: "delete", messageId: "m-2", message: null },
      ],
    });

    expect(parsed.changes).toHaveLength(2);
    expect(parsed.changes[0]?.message?.id).toBe("m-1");
    expect(parsed.changes[1]).toStrictEqual({ cursor: "8", kind: "delete", messageId: "m-2" });
  });

  it("carries the paging flags", () => {
    expect(parseMessageSyncPage({ ...page, hasMore: true, resetRequired: true })).toMatchObject({
      nextCursor: "9",
      hasMore: true,
      resetRequired: true,
    });
  });

  it("rejects a change kind it does not know", () => {
    expectMalformed(() =>
      parseMessageSyncPage({
        ...page,
        changes: [{ cursor: "7", kind: "move", messageId: "m-1" }],
      }),
    );
  });

  it("requires the cursor and both flags", () => {
    expectMalformed(() => parseMessageSyncPage({ ...page, nextCursor: undefined }));
    expectMalformed(() => parseMessageSyncPage({ ...page, hasMore: "no" }));
    expectMalformed(() => parseMessageSyncPage({ ...page, resetRequired: undefined }));
    expectMalformed(() => parseMessageSyncPage({ ...page, changes: undefined }));
  });
});

describe("parseThreadSummary", () => {
  it("reads the root reference and the reply count", () => {
    expect(
      parseThreadSummary({
        channelId: "c-1",
        root: { id: "m-1", authorId: "u-1", authorName: "Maja", preview: "Temat" },
        replyCount: 3,
        lastReplyAt: "2026-01-01T20:00:00Z",
      }),
    ).toStrictEqual({
      channelId: "c-1",
      root: { id: "m-1", authorId: "u-1", authorName: "Maja", preview: "Temat" },
      replyCount: 3,
      lastReplyAt: "2026-01-01T20:00:00Z",
    });
  });

  it("requires a root that names a message", () => {
    const base = { channelId: "c-1", replyCount: 1, lastReplyAt: "2026-01-01T20:00:00Z" };

    expectMalformed(() => parseThreadSummary(base));
    expectMalformed(() => parseThreadSummary({ ...base, root: { preview: "x" } }));
  });
});

describe("parseEmbedsUpdate", () => {
  it("reads the embeds built for a message", () => {
    const update = parseEmbedsUpdate({
      messageId: "m-1",
      channelId: "c-1",
      embeds: [{ id: "e-1", url: "https://example.com" }],
    });

    expect(update.embeds).toHaveLength(1);
    expect(update.embeds[0]).toMatchObject({ id: "e-1", kind: "link" });
  });

  it("reads a missing list as no embeds, and requires the ids", () => {
    expect(parseEmbedsUpdate({ messageId: "m-1", channelId: "c-1" }).embeds).toEqual([]);
    expectMalformed(() => parseEmbedsUpdate({ channelId: "c-1" }));
  });
});

describe("parseReactionChanged", () => {
  it("reads the authoritative aggregate", () => {
    expect(
      parseReactionChanged({
        messageId: "m-1",
        channelId: "c-1",
        emoji: "👍",
        count: 3,
        userId: "u-2",
        added: true,
      }),
    ).toStrictEqual({
      messageId: "m-1",
      channelId: "c-1",
      emoji: "👍",
      count: 3,
      userId: "u-2",
      added: true,
    });
  });

  it("reads anything but true as a removal and insists on a finite count", () => {
    const base = { messageId: "m-1", channelId: "c-1", emoji: "👍", count: 0, userId: "u-2" };

    expect(parseReactionChanged({ ...base, added: "yes" }).added).toBe(false);
    expectMalformed(() => parseReactionChanged({ ...base, count: "0" }));
  });
});

describe("parseChannelRead", () => {
  it("reads the read watermark", () => {
    expect(
      parseChannelRead({ channelId: "c-1", lastReadAt: "2026-01-01T19:01:00Z" }),
    ).toStrictEqual({ channelId: "c-1", lastReadAt: "2026-01-01T19:01:00Z" });
  });

  it("requires both fields", () => {
    expectMalformed(() => parseChannelRead({ channelId: "c-1" }));
    expectMalformed(() => parseChannelRead({ lastReadAt: "2026-01-01T19:01:00Z" }));
  });
});

describe("parseInboxNotification", () => {
  const notification = {
    id: "n-1",
    sequence: 4,
    title: "Zaproszenie",
    body: "Olek zaprasza Cię.",
    tone: "info",
    source: {
      type: "system",
      packageId: "stellarr.core",
      packageName: "Stellarr",
      moduleId: "invites",
      moduleName: "Zaproszenia",
    },
    createdAt: "2026-01-01T19:00:00Z",
  };

  it("reads an unread notification without a target", () => {
    const parsed = parseInboxNotification(notification, "/p");

    expect(parsed).toStrictEqual(notification);
  });

  it("reads the read time and a channel target", () => {
    const parsed = parseInboxNotification(
      {
        ...notification,
        readAt: "2026-01-01T19:05:00Z",
        target: { type: "channel", channelId: "c-1" },
      },
      "/p",
    );

    expect(parsed.readAt).toBe("2026-01-01T19:05:00Z");
    expect(parsed.target).toStrictEqual({ type: "channel", channelId: "c-1" });
  });

  it("treats a null read time and a null target as absent", () => {
    const parsed = parseInboxNotification({ ...notification, readAt: null, target: null }, "/p");

    expect("readAt" in parsed).toBe(false);
    expect("target" in parsed).toBe(false);
  });

  it("reads a server-invite target with everything needed to join", () => {
    const target = {
      type: "server-invite",
      inviteCode: "abc123",
      serverId: "srv-2",
      serverName: "Lagoon",
      invitedByName: "Olek",
    };

    expect(parseInboxNotification({ ...notification, target }, "/p").target).toStrictEqual(target);
  });

  it.each(["neutral", "info", "success", "warning", "danger"])("accepts the %s tone", (tone) => {
    expect(parseInboxNotification({ ...notification, tone }, "/p").tone).toBe(tone);
  });

  it("accepts sdk and system sources", () => {
    const source = { ...notification.source, type: "sdk" };

    expect(parseInboxNotification({ ...notification, source }, "/p").source.type).toBe("sdk");
  });

  it("rejects an unknown tone, source type or target type", () => {
    expectMalformed(() => parseInboxNotification({ ...notification, tone: "loud" }, "/p"));
    expectMalformed(() =>
      parseInboxNotification({ ...notification, source: { ...notification.source, type: "bot" } }, "/p"),
    );
    expectMalformed(() =>
      parseInboxNotification({ ...notification, target: { type: "message", messageId: "m-1" } }, "/p"),
    );
  });

  it("rejects a sequence below one and a non-string read time", () => {
    expectMalformed(() => parseInboxNotification({ ...notification, sequence: 0 }, "/p"));
    expectMalformed(() => parseInboxNotification({ ...notification, sequence: 1.5 }, "/p"));
    expectMalformed(() => parseInboxNotification({ ...notification, readAt: 12 }, "/p"));
  });

  it("rejects a payload missing a required field", () => {
    for (const field of ["id", "title", "body", "tone", "source", "createdAt"]) {
      expectMalformed(() => parseInboxNotification({ ...notification, [field]: undefined }, "/p"));
    }
    expectMalformed(() =>
      parseInboxNotification(
        { ...notification, source: { type: "system", packageId: "x" } },
        "/p",
      ),
    );
    expectMalformed(() =>
      parseInboxNotification(
        { ...notification, target: { type: "server-invite", inviteCode: "abc" } },
        "/p",
      ),
    );
  });
});

describe("parseNotificationPage", () => {
  const item = {
    id: "n-1",
    sequence: 4,
    title: "T",
    body: "B",
    tone: "neutral",
    source: { type: "system", packageId: "p", packageName: "P", moduleId: "m", moduleName: "M" },
    createdAt: "2026-01-01T19:00:00Z",
  };
  const page = { items: [item], nextBeforeSequence: 4, unreadCount: 1, lastSequence: 4 };

  it("reads a page with the cursor for the next older one", () => {
    const parsed = parseNotificationPage(page, "/p");

    expect(parsed.items).toHaveLength(1);
    expect(parsed).toMatchObject({ nextBeforeSequence: 4, unreadCount: 1, lastSequence: 4 });
  });

  it("accepts a null cursor on the last page", () => {
    expect(parseNotificationPage({ ...page, nextBeforeSequence: null }, "/p").nextBeforeSequence).toBeNull();
  });

  it("requires the cursor to be present, positive and a safe integer", () => {
    expectMalformed(() => parseNotificationPage({ ...page, nextBeforeSequence: undefined }, "/p"));
    expectMalformed(() => parseNotificationPage({ ...page, nextBeforeSequence: 0 }, "/p"));
    expectMalformed(() => parseNotificationPage({ ...page, nextBeforeSequence: 2.5 }, "/p"));
    expectMalformed(() => parseNotificationPage({ ...page, nextBeforeSequence: "4" }, "/p"));
  });

  it("requires non-negative counters and valid items", () => {
    expectMalformed(() => parseNotificationPage({ ...page, unreadCount: -1 }, "/p"));
    expectMalformed(() => parseNotificationPage({ ...page, lastSequence: undefined }, "/p"));
    expectMalformed(() =>
      parseNotificationPage({ ...page, items: [{ ...item, tone: "loud" }] }, "/p"),
    );
    expectMalformed(() => parseNotificationPage({ ...page, items: undefined }, "/p"));
  });
});
