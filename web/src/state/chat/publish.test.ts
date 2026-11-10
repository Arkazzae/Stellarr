import { afterEach, describe, expect, it, vi } from "vitest";

import type { Attachment, MessageReference } from "@/ports";

import {
  clearFailed,
  clientIdFor,
  optimisticMessage,
  publishFingerprint,
  toSendMessage,
} from "./publish";

const attachment = (id: string): Attachment => ({
  id,
  url: `/files/${id}`,
  name: id,
  contentType: "text/plain",
  size: 1,
});
const answering: MessageReference = {
  id: "m-1",
  authorId: "u-ada",
  authorName: "Ada",
  preview: "hello",
};

afterEach(() => vi.useRealTimers());

describe("publishFingerprint", () => {
  it("is the same for the same send and different when any part differs", () => {
    const base = publishFingerprint("c", "hi", [attachment("a1")], answering);
    expect(publishFingerprint("c", "hi", [attachment("a1")], answering)).toBe(base);
    expect(publishFingerprint("other", "hi", [attachment("a1")], answering)).not.toBe(base);
    expect(publishFingerprint("c", "hi!", [attachment("a1")], answering)).not.toBe(base);
    expect(publishFingerprint("c", "hi", [attachment("a2")], answering)).not.toBe(base);
    expect(publishFingerprint("c", "hi", [attachment("a1")], null)).not.toBe(base);
  });
});

describe("clientIdFor", () => {
  const fingerprint = publishFingerprint("c", "hi", [], null);

  it("mints a fresh id for a send that did not fail before", () => {
    const first = clientIdFor(null, fingerprint);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(clientIdFor(null, fingerprint)).not.toBe(first);
  });

  it("reuses the id of the identical send that failed", () => {
    const failed = { fingerprint, clientMessageId: "same-key" };
    expect(clientIdFor(failed, fingerprint)).toBe("same-key");
  });

  it("does not reuse it once the text changed", () => {
    const failed = { fingerprint, clientMessageId: "same-key" };
    expect(clientIdFor(failed, publishFingerprint("c", "hi again", [], null))).not.toBe("same-key");
  });
});

describe("clearFailed", () => {
  it("forgets the failure that the successful send belongs to", () => {
    expect(clearFailed({ fingerprint: "f", clientMessageId: "k" }, "k")).toBeNull();
  });

  it("keeps a failure that belongs to some other send", () => {
    const failed = { fingerprint: "f", clientMessageId: "k" };
    expect(clearFailed(failed, "other")).toBe(failed);
    expect(clearFailed(null, "k")).toBeNull();
  });
});

describe("optimisticMessage", () => {
  const outgoing = {
    channelId: "ch-general",
    text: "hi",
    attachments: [attachment("a1")],
    answering: null,
    clientMessageId: "key-1",
  };

  it("shows under the client id, by the sender, with no cards yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    expect(optimisticMessage(outgoing, { id: "u-maja", displayName: "Maja" })).toEqual({
      id: "key-1",
      channelId: "ch-general",
      author: { id: "u-maja", displayName: "Maja" },
      content: "hi",
      attachments: [attachment("a1")],
      embeds: [],
      createdAt: "2026-01-01T12:00:00.000Z",
    });
  });

  it("carries the message it answers", () => {
    const shown = optimisticMessage({ ...outgoing, answering }, { id: "u", displayName: "U" });
    expect(shown.replyTo).toEqual(answering);
  });
});

describe("toSendMessage", () => {
  it("sends attachment ids and the idempotency key", () => {
    expect(
      toSendMessage({
        channelId: "c",
        text: "hi",
        attachments: [attachment("a1"), attachment("a2")],
        answering: null,
        clientMessageId: "key-1",
      }),
    ).toEqual({
      channelId: "c",
      content: "hi",
      attachmentIds: ["a1", "a2"],
      clientMessageId: "key-1",
    });
  });

  it("names the message being answered", () => {
    const sent = toSendMessage({
      channelId: "c",
      text: "yes",
      attachments: [],
      answering,
      clientMessageId: "key-2",
    });
    expect(sent.replyToMessageId).toBe("m-1");
  });
});
