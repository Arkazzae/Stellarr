import { describe, expect, it } from "vitest";

import { shouldPlayMessageNotificationSound } from "./notifications";

const message = {
  authorId: "user-other",
  channelId: "channel-general",
  selfId: "user-self",
  selfUsername: "ada",
  openChannelId: "channel-general",
  soundEnabled: true,
  mentionsOnly: true,
  mutedChannelIds: [] as string[],
};

function mentioned(content: string, username = "ada"): boolean {
  return shouldPlayMessageNotificationSound({ ...message, content, selfUsername: username });
}

describe("which text counts as a mention", () => {
  it.each(["@ada", "hej @ada!", "@Ada, are you there?", "(@ada)", "hi\n@ada"])(
    "recognises %j",
    (content) => {
      expect(mentioned(content)).toBe(true);
    },
  );

  it.each([
    ["a longer name", "@adam"],
    ["a name that continues with a dot or dash", "@ada-lovelace"],
    ["an e-mail address", "write to x@ada"],
    ["no mention at all", "hello ada"],
  ])("does not treat %s as a mention", (_label, content) => {
    expect(mentioned(content)).toBe(false);
  });

  it("ignores mentions inside fenced, inline and html code, even unterminated", () => {
    expect(mentioned("```\n@ada\n```")).toBe(false);
    expect(mentioned("```\n@ada")).toBe(false);
    expect(mentioned("`@ada`")).toBe(false);
    expect(mentioned("<code>@ada</code>")).toBe(false);
    expect(mentioned("<CODE>@ada")).toBe(false);
  });

  it("finds a mention that follows code", () => {
    expect(mentioned("`code` then @ada")).toBe(true);
  });

  it("ignores a mention inside a link but not next to it", () => {
    expect(mentioned("https://example.test/@ada")).toBe(false);
    expect(mentioned("https://example.test/ @ada")).toBe(true);
  });

  it("matches a name literally, whatever characters it has", () => {
    expect(mentioned("@a.b", "a.b")).toBe(true);
    expect(mentioned("@axb", "a.b")).toBe(false);
    expect(mentioned("@c++ fan", "c++")).toBe(true);
  });
});

describe("when a mention still stays silent", () => {
  it("never rings for the user's own message, a muted channel or disabled sound", () => {
    const content = "@ada";

    expect(
      shouldPlayMessageNotificationSound({ ...message, content, authorId: "user-self" }),
    ).toBe(false);
    expect(
      shouldPlayMessageNotificationSound({
        ...message,
        content,
        mutedChannelIds: ["channel-general"],
      }),
    ).toBe(false);
    expect(
      shouldPlayMessageNotificationSound({ ...message, content, soundEnabled: false }),
    ).toBe(false);
  });

  it("does not know a mention without the user's name", () => {
    expect(
      shouldPlayMessageNotificationSound({ ...message, content: "@ada", selfUsername: null }),
    ).toBe(false);
  });
});

describe("messages without a mention", () => {
  const plain = { ...message, content: "hello" };

  it("ring for another channel unless only mentions are wanted", () => {
    const elsewhere = { ...plain, openChannelId: "channel-other" };

    expect(shouldPlayMessageNotificationSound({ ...elsewhere, mentionsOnly: false })).toBe(true);
    expect(shouldPlayMessageNotificationSound({ ...elsewhere, mentionsOnly: true })).toBe(false);
  });

  it("stay silent in the channel that is open", () => {
    expect(shouldPlayMessageNotificationSound({ ...plain, mentionsOnly: false })).toBe(false);
  });

  it("ring for any channel when none is open", () => {
    expect(
      shouldPlayMessageNotificationSound({ ...plain, mentionsOnly: false, openChannelId: null }),
    ).toBe(true);
  });
});
