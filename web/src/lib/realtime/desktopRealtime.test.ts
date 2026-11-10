import { describe, expect, it } from "vitest";

import { parseDesktopHubPayload } from "./desktopPayload";

describe("desktop realtime payload boundary", () => {
  it("normalizes a root message with a null reply before it reaches chat state", () => {
    const payload = parseDesktopHubPayload("MessageCreated", {
      id: "message-1",
      channelId: "channel-1",
      author: { id: "user-1", displayName: "Patryk" },
      content: "Test",
      attachments: [],
      embeds: [],
      reactions: [],
      replyTo: null,
      editedAt: null,
      pinnedAt: null,
      createdAt: "2026-09-01T14:00:00.000Z",
    });

    expect(payload).toMatchObject({ id: "message-1", content: "Test" });
    expect(payload).not.toHaveProperty("replyTo");
    expect(payload).not.toHaveProperty("editedAt");
    expect(payload).not.toHaveProperty("pinnedAt");
  });
});
