import { describe, expect, it } from "vitest";

import { RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
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

describe("desktop realtime media events", () => {
  const signal = {
    protocolVersion: RTC_PROTOCOL_VERSION,
    channelId: "voice-1",
    sessionId: "session-7",
    kind: "tracks",
    payload: '{"tracks":[]}',
  };

  it("decodes a media server signal with the browser's parser", () => {
    expect(parseDesktopHubPayload("MediaSignal", { ...signal, extra: true })).toEqual(signal);
  });

  it("throws on a media signal the browser would drop, so the event is dropped", () => {
    expect(() => parseDesktopHubPayload("MediaSignal", { ...signal, kind: "candidate" })).toThrow();
    expect(() => parseDesktopHubPayload("MediaSignal", { ...signal, protocolVersion: 2 })).toThrow();
  });

  it("decodes a closure and throws on one with an unknown reason", () => {
    const closed = { channelId: "voice-1", sessionId: "session-7", reason: "transport-timeout" };

    expect(parseDesktopHubPayload("MediaSessionClosed", closed)).toEqual(closed);
    expect(() =>
      parseDesktopHubPayload("MediaSessionClosed", { ...closed, reason: "bored" }),
    ).toThrow();
  });
});
