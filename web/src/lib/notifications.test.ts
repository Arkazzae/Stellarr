import { describe, expect, it } from "vitest";

import {
  notificationPreview,
  shouldPlayMessageNotificationSound,
  shouldShowMentionNotification,
} from "./notifications";

const incoming = {
  authorId: "user-other",
  channelId: "channel-news",
  selfId: "user-self",
  openChannelId: "channel-general",
  soundEnabled: true,
  mutedChannelIds: [] as string[],
};

describe("shouldPlayMessageNotificationSound", () => {
  it("plays only for an unmuted incoming message outside the open channel", () => {
    expect(shouldPlayMessageNotificationSound(incoming)).toBe(true);
    expect(
      shouldPlayMessageNotificationSound({
        ...incoming,
        mutedChannelIds: ["channel-news"],
      }),
    ).toBe(false);
    expect(
      shouldPlayMessageNotificationSound({
        ...incoming,
        openChannelId: "channel-news",
      }),
    ).toBe(false);
    expect(
      shouldPlayMessageNotificationSound({
        ...incoming,
        authorId: "user-self",
      }),
    ).toBe(false);
    expect(
      shouldPlayMessageNotificationSound({
        ...incoming,
        soundEnabled: false,
      }),
    ).toBe(false);
  });

  it("pings for an explicit mention, including in the open channel", () => {
    expect(shouldPlayMessageNotificationSound({
      ...incoming,
      channelId: "channel-general",
      openChannelId: "channel-general",
      content: "hej @Ada",
      selfUsername: "ada",
      mentionsOnly: true,
    })).toBe(true);
    expect(shouldPlayMessageNotificationSound({
      ...incoming,
      content: "`@ada` oraz https://example.test/@ada",
      selfUsername: "ada",
      mentionsOnly: true,
    })).toBe(false);
  });
});

describe("shouldShowMentionNotification", () => {
  const mention = {
    authorId: "user-other",
    channelId: "channel-news",
    content: "@ada spójrz na to",
    selfId: "user-self",
    selfUsername: "ada",
    enabled: true,
    mutedChannelIds: [] as string[],
    away: true,
  };

  it("pops up a mention while the person is away from the app", () => {
    expect(shouldShowMentionNotification(mention)).toBe(true);
  });

  it("leaves a plain message, a quoted name and one's own message alone", () => {
    expect(shouldShowMentionNotification({ ...mention, content: "spójrz na to" })).toBe(false);
    expect(shouldShowMentionNotification({ ...mention, content: "`@ada`" })).toBe(false);
    expect(shouldShowMentionNotification({ ...mention, authorId: "user-self" })).toBe(false);
  });

  it("stays quiet in front of the app, in a muted channel and with the switch off", () => {
    expect(shouldShowMentionNotification({ ...mention, away: false })).toBe(false);
    expect(shouldShowMentionNotification({ ...mention, mutedChannelIds: ["channel-news"] })).toBe(false);
    expect(shouldShowMentionNotification({ ...mention, enabled: false })).toBe(false);
    expect(shouldShowMentionNotification({ ...mention, selfUsername: null })).toBe(false);
  });
});

describe("notificationPreview", () => {
  it("puts a message on one line and cuts a long one at a word's end", () => {
    expect(notificationPreview("  hej\n\nAda  ")).toBe("hej Ada");
    expect(notificationPreview("a ".repeat(100), 10)).toBe("a a a a a…");
  });
});
