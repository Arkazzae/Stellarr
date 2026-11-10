import { describe, expect, it } from "vitest";

import { shouldPlayMessageNotificationSound } from "./notifications";

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
