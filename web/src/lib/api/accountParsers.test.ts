import { describe, expect, it } from "vitest";

import {
  parseAccount,
  parseFriendRequestAnswer,
  parsePasswordAnswer,
  parseClientSettings,
  parsePreferences,
  parseSocialState,
  parseUser,
} from "./accountParsers";

function expectMalformed(action: () => unknown): void {
  expect(action).toThrow(expect.objectContaining({ name: "ApiError", kind: "malformed" }));
}

const USER = { id: "u-1", username: "maja", displayName: "Maja", presence: "online" };

describe("parseUser", () => {
  it("reads the identity of a user", () => {
    expect(parseUser(USER, "/p")).toStrictEqual(USER);
  });

  it("shows the username when there is no display name", () => {
    expect(parseUser({ id: "u-1", username: "maja", presence: "idle" }, "/p").displayName).toBe(
      "maja",
    );
  });

  it("reads a presence it does not know as offline", () => {
    expect(parseUser({ ...USER, presence: "away" }, "/p").presence).toBe("offline");
    expect(parseUser({ ...USER, presence: undefined }, "/p").presence).toBe("offline");
  });

  it("keeps profile fields only when the server sent them", () => {
    expect(Object.keys(parseUser(USER, "/p")).sort()).toEqual([
      "displayName",
      "id",
      "presence",
      "username",
    ]);

    expect(
      parseUser(
        {
          ...USER,
          avatarUrl: "/avatars/u-1",
          bannerUrl: "/banners/u-1",
          customStatus: "Kawa",
          bio: "Cześć",
          pronouns: "ona/jej",
        },
        "/p",
      ),
    ).toMatchObject({
      avatarUrl: "/avatars/u-1",
      bannerUrl: "/banners/u-1",
      customStatus: "Kawa",
      bio: "Cześć",
      pronouns: "ona/jej",
    });
  });

  it("requires an id and a username", () => {
    expectMalformed(() => parseUser(null, "/p"));
    expectMalformed(() => parseUser({ username: "maja" }, "/p"));
    expectMalformed(() => parseUser({ id: "u-1" }, "/p"));
  });
});

describe("parseClientSettings", () => {
  it("keeps each saved section and reads anything else as never saved", () => {
    expect(
      parseClientSettings(
        { appearance: { palette: "ember" }, language: null, keybinds: [1], voice: "loud" },
        "/api/me/settings",
      ),
    ).toEqual({ appearance: { palette: "ember" }, language: null, keybinds: null, voice: null });
  });

  it("reads an older server's missing sections as never saved", () => {
    expect(parseClientSettings({}, "/api/me/settings")).toEqual({
      appearance: null,
      language: null,
      keybinds: null,
      voice: null,
    });
  });
});

describe("parsePreferences", () => {
  it("reads what the server stored", () => {
    expect(
      parsePreferences(
        {
          desktopNotifications: false,
          mentionPopups: false,
          callRingtone: false,
          emailNotifications: true,
          pushNotifications: true,
          mentionsOnly: false,
          messageSound: false,
          joinLeaveSound: false,
          allowDirectMessages: false,
          allowFriendRequests: false,
          showPresence: false,
          developerMode: true,
          reducedMotion: true,
          mutedChannelIds: ["c-1", "c-2"],
          vadSensitivity: 35,
          joinSoundId: "sound-1",
        },
        "/p",
      ),
    ).toStrictEqual({
      desktopNotifications: false,
      mentionPopups: false,
      callRingtone: false,
      emailNotifications: true,
      pushNotifications: true,
      mentionsOnly: false,
      messageSound: false,
      joinLeaveSound: false,
      allowDirectMessages: false,
      allowFriendRequests: false,
      showPresence: false,
      developerMode: true,
      reducedMotion: true,
      mutedChannelIds: ["c-1", "c-2"],
      vadSensitivity: 35,
      joinSoundId: "sound-1",
    });
  });

  it("falls back to the defaults for what an older server does not send", () => {
    expect(parsePreferences({}, "/p")).toStrictEqual({
      desktopNotifications: true,
      // Mentions and calls got their own switches on: what they did before.
      mentionPopups: true,
      callRingtone: true,
      emailNotifications: false,
      pushNotifications: false,
      mentionsOnly: true,
      messageSound: true,
      joinLeaveSound: true,
      allowDirectMessages: true,
      allowFriendRequests: true,
      showPresence: true,
      developerMode: false,
      reducedMotion: false,
      mutedChannelIds: [],
      vadSensitivity: 60,
      joinSoundId: null,
    });
  });

  it("ignores a switch of the wrong type", () => {
    expect(parsePreferences({ mentionsOnly: "no", messageSound: 0 }, "/p")).toMatchObject({
      mentionsOnly: true,
      messageSound: true,
    });
  });

  it("keeps the voice sensitivity only when it is a whole number from 0 to 100", () => {
    expect(parsePreferences({ vadSensitivity: 0 }, "/p").vadSensitivity).toBe(0);
    expect(parsePreferences({ vadSensitivity: 100 }, "/p").vadSensitivity).toBe(100);
    for (const bad of [101, -1, 12.5, "50", null]) {
      expect(parsePreferences({ vadSensitivity: bad }, "/p").vadSensitivity).toBe(60);
    }
  });

  it("drops muted channel ids that are not strings", () => {
    expect(parsePreferences({ mutedChannelIds: ["c-1", 2, null] }, "/p").mutedChannelIds).toEqual([
      "c-1",
    ]);
  });

  it("requires an object", () => {
    expectMalformed(() => parsePreferences(undefined, "/p"));
  });
});

describe("parseAccount", () => {
  const account = {
    id: "u-1",
    username: "maja",
    displayName: "Maja",
    createdAt: "2026-01-01T00:00:00Z",
    preferences: {},
  };

  it("reads the private account data with empty profile text by default", () => {
    const parsed = parseAccount(account);

    expect(parsed).toMatchObject({
      id: "u-1",
      username: "maja",
      displayName: "Maja",
      createdAt: "2026-01-01T00:00:00Z",
      customStatus: "",
      bio: "",
      pronouns: "",
    });
    expect(parsed.preferences.vadSensitivity).toBe(60);
  });

  it("keeps the email and the images only when present", () => {
    expect(Object.keys(parseAccount(account))).not.toEqual(
      expect.arrayContaining(["email", "avatarUrl", "bannerUrl"]),
    );
    expect(
      parseAccount({ ...account, email: "maja@example.com", avatarUrl: "/a", bannerUrl: "/b" }),
    ).toMatchObject({ email: "maja@example.com", avatarUrl: "/a", bannerUrl: "/b" });
  });

  it("requires the identity, the creation time and the preferences object", () => {
    expectMalformed(() => parseAccount({ ...account, displayName: undefined }));
    expectMalformed(() => parseAccount({ ...account, createdAt: undefined }));
    expectMalformed(() => parseAccount({ ...account, preferences: undefined }));
  });

  it("names the endpoint it was parsed from", () => {
    expect(() => parseAccount({ ...account, id: 1 }, "/api/me/images/avatar")).toThrow(
      "/api/me/images/avatar",
    );
  });
});

describe("parsePasswordAnswer", () => {
  it.each(["changed", "wrong-current", "too-short", "same-as-current"])(
    "accepts %s",
    (result) => {
      expect(parsePasswordAnswer({ result }, "/p")).toBe(result);
    },
  );

  it("rejects any other result", () => {
    expectMalformed(() => parsePasswordAnswer({ result: "weak" }, "/p"));
    expectMalformed(() => parsePasswordAnswer({}, "/p"));
  });
});

describe("parseFriendRequestAnswer", () => {
  it.each(["sent", "unknown-user", "already-friends", "already-sent", "self", "blocked"])(
    "accepts %s",
    (result) => {
      expect(parseFriendRequestAnswer({ result }, "/p")).toBe(result);
    },
  );

  it("rejects any other result", () => {
    expectMalformed(() => parseFriendRequestAnswer({ result: "pending" }, "/p"));
    expectMalformed(() => parseFriendRequestAnswer("sent", "/p"));
  });
});

describe("parseSocialState", () => {
  const peer = { id: "u-2", username: "olek", displayName: "Olek", presence: "dnd" };
  const state = {
    friends: [{ user: peer, since: "2026-01-02T00:00:00Z" }],
    requests: [
      { id: "r-1", user: peer, direction: "incoming", sentAt: "2026-01-03T00:00:00Z" },
      { id: "r-2", user: peer, direction: "sideways", sentAt: "2026-01-04T00:00:00Z" },
    ],
    blocked: [peer],
    conversations: [
      {
        id: "dm-1",
        peer,
        unread: 2,
        updatedAt: "2026-01-05T00:00:00Z",
        lastMessage: {
          id: "m-1",
          channelId: "dm-1",
          author: { id: "u-2", displayName: "Olek" },
          content: "Hej",
          createdAt: "2026-01-05T00:00:00Z",
        },
      },
      { id: "dm-2", peer, updatedAt: "2026-01-06T00:00:00Z" },
    ],
  };

  it("reads friends, requests, blocked users and conversations", () => {
    const parsed = parseSocialState(state);

    expect(parsed.friends).toStrictEqual([
      { user: parseUser(peer, "/p"), since: "2026-01-02T00:00:00Z" },
    ]);
    expect(parsed.blocked).toStrictEqual([parseUser(peer, "/p")]);
    expect(parsed.conversations[0]).toMatchObject({
      id: "dm-1",
      unread: 2,
      lastMessage: { id: "m-1", content: "Hej" },
    });
  });

  it("reads any direction but incoming as outgoing", () => {
    expect(parseSocialState(state).requests.map((request) => request.direction)).toEqual([
      "incoming",
      "outgoing",
    ]);
  });

  it("defaults the unread count and leaves a missing last message out", () => {
    const conversation = parseSocialState(state).conversations[1];

    expect(conversation?.unread).toBe(0);
    expect(conversation && "lastMessage" in conversation).toBe(false);
  });

  it("requires all four lists", () => {
    for (const key of ["friends", "requests", "blocked", "conversations"]) {
      expectMalformed(() => parseSocialState({ ...state, [key]: undefined }));
    }
  });

  it("requires well-formed entries", () => {
    expectMalformed(() => parseSocialState({ ...state, friends: [{ since: "x" }] }));
    expectMalformed(() => parseSocialState({ ...state, requests: [{ id: "r-1", user: peer }] }));
    expectMalformed(() =>
      parseSocialState({ ...state, conversations: [{ id: "dm-1", updatedAt: "x" }] }),
    );
  });
});
