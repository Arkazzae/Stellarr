import { describe, expect, it } from "vitest";
import { RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
import {
  HUB_DECODERS,
  parseMediaSessionClosed,
  parseMediaSessionOpened,
  parseMediaSignal,
  parseVoiceSignal,
} from "./hubPayloads";

describe("hub payload decoders", () => {
  it("drops anything that is not a record", () => {
    for (const payload of [null, undefined, "text", 3, ["a"]]) {
      expect(HUB_DECODERS.TypingChanged(payload)).toBeNull();
      expect(HUB_DECODERS.PresenceChanged(payload)).toBeNull();
      expect(HUB_DECODERS.NotificationInboxChanged(payload)).toBeNull();
    }
  });

  it("keeps only the declared string fields of id-only events", () => {
    expect(
      HUB_DECODERS.MessageDeleted({ messageId: "m1", channelId: "c1", extra: 1 }),
    ).toEqual({ messageId: "m1", channelId: "c1" });
    expect(HUB_DECODERS.MessageDeleted({ messageId: "m1" })).toBeNull();
    expect(HUB_DECODERS.VoiceChannelMoved({ fromChannelId: "a", toChannelId: 2 })).toBeNull();
    expect(
      HUB_DECODERS.TypingChanged({
        channelId: "c1",
        userId: "u1",
        displayName: "Ada",
        expiresAt: "2026-09-01T14:00:05.000Z",
      }),
    ).toEqual({
      channelId: "c1",
      userId: "u1",
      displayName: "Ada",
      expiresAt: "2026-09-01T14:00:05.000Z",
    });
  });

  it("drops a message that fails the wire parser instead of throwing", () => {
    expect(HUB_DECODERS.MessageCreated({ id: "m1" })).toBeNull();
    expect(HUB_DECODERS.MessageUpdated("not a message")).toBeNull();
  });

  it("accepts only known presences", () => {
    expect(HUB_DECODERS.PresenceChanged({ userId: "u1", presence: "dnd" })).toEqual({
      userId: "u1",
      presence: "dnd",
    });
    expect(HUB_DECODERS.PresenceChanged({ userId: "u1", presence: "away" })).toBeNull();
  });

  it("filters unknown permissions and requires a list", () => {
    expect(
      HUB_DECODERS.PermissionsChanged({
        serverId: "s1",
        permissions: ["manageChannels", "Teleport", 7],
      }),
    ).toEqual({ serverId: "s1", permissions: ["manageChannels"] });
    expect(HUB_DECODERS.PermissionsChanged({ serverId: "s1", permissions: "all" })).toBeNull();
  });

  it("accepts only kicked or banned as the reason for lost access", () => {
    expect(HUB_DECODERS.ServerAccessRevoked({ serverId: "s1", kind: "banned" })).toEqual({
      serverId: "s1",
      kind: "banned",
    });
    expect(HUB_DECODERS.ServerAccessRevoked({ serverId: "s1", kind: "left" })).toBeNull();
  });

  it("treats a null inbox sequence as absent and forwards only global: true", () => {
    expect(
      HUB_DECODERS.NotificationInboxChanged({ serverId: "s1", sequence: null, global: false }),
    ).toEqual({ serverId: "s1" });
    expect(HUB_DECODERS.NotificationInboxChanged({ serverId: "s1", global: true })).toEqual({
      serverId: "s1",
      global: true,
    });
    for (const bad of [
      { serverId: "s1", sequence: 0 },
      { serverId: "s1", sequence: 1.5 },
      { serverId: "s1", global: null },
    ]) {
      expect(HUB_DECODERS.NotificationInboxChanged(bad)).toBeNull();
    }
  });

  it("normalises voice occupancy and rejects a null sequence", () => {
    expect(
      HUB_DECODERS.VoiceParticipantChanged({
        channelId: "v1",
        participants: [
          { userId: "u1", displayName: "Ada", muted: true },
          { userId: "u2", muted: "yes" },
          { displayName: "nobody" },
        ],
      }),
    ).toEqual({
      channelId: "v1",
      participants: [
        { userId: "u1", displayName: "Ada", muted: true },
        { userId: "u2", displayName: "u2", muted: false },
      ],
    });
    expect(
      HUB_DECODERS.VoiceParticipantChanged({ channelId: "v1", sequence: null, participants: [] }),
    ).toBeNull();
    expect(
      HUB_DECODERS.VoiceParticipantChanged({ channelId: "v1", sequence: 0, participants: [] }),
    ).toBeNull();
  });

  it("emits an empty payload for pure invalidations", () => {
    expect(HUB_DECODERS.SocialChanged(undefined)).toEqual({});
    expect(HUB_DECODERS.EmojiChanged({ anything: true })).toEqual({});
  });
});

describe("parseVoiceSignal", () => {
  it("leaves out the addressing fields the server did not set", () => {
    const parsed = parseVoiceSignal({
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: "v1",
      kind: "state",
      payload: "{}",
      fromUserId: 4,
    });
    expect(parsed).toEqual({
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: "v1",
      kind: "state",
      payload: "{}",
    });
    expect(parsed).not.toHaveProperty("fromUserId");
    expect(parsed).not.toHaveProperty("toUserId");
  });
});

describe("parseMediaSignal", () => {
  const signal = {
    protocolVersion: RTC_PROTOCOL_VERSION,
    channelId: "v1",
    sessionId: "session-1",
    kind: "tracks",
    payload: '{"tracks":[]}',
  };

  it("accepts every kind the media server sends", () => {
    for (const kind of ["offer", "answer", "tracks"]) {
      expect(parseMediaSignal({ ...signal, kind })).toEqual({ ...signal, kind });
    }
    expect(HUB_DECODERS.MediaSignal(signal)).toEqual(signal);
  });

  it("drops a candidate, which the media server never trickles", () => {
    expect(parseMediaSignal({ ...signal, kind: "candidate" })).toBeNull();
  });

  it("drops an unknown version or kind and a missing session", () => {
    for (const bad of [
      { ...signal, protocolVersion: 2 },
      { ...signal, kind: "state" },
      { ...signal, sessionId: "" },
      { ...signal, sessionId: 7 },
      { ...signal, channelId: null },
      { ...signal, payload: { tracks: [] } },
      "signal",
    ]) {
      expect(parseMediaSignal(bad)).toBeNull();
    }
  });

  it("keeps only the envelope's own fields", () => {
    expect(parseMediaSignal({ ...signal, fromUserId: "u-1" })).not.toHaveProperty("fromUserId");
  });
});

describe("parseMediaSessionClosed", () => {
  it("accepts the three reasons of the contract", () => {
    for (const reason of ["media-restarted", "transport-timeout", "error"]) {
      expect(
        HUB_DECODERS.MediaSessionClosed({ channelId: "v1", sessionId: "session-1", reason }),
      ).toEqual({ channelId: "v1", sessionId: "session-1", reason });
    }
  });

  it("drops a closure it cannot attribute or explain", () => {
    for (const bad of [
      { channelId: "v1", sessionId: "session-1", reason: "left" },
      { channelId: "v1", sessionId: "session-1" },
      { channelId: "v1", sessionId: "", reason: "error" },
      { sessionId: "session-1", reason: "error" },
      null,
    ]) {
      expect(parseMediaSessionClosed(bad)).toBeNull();
    }
  });
});

describe("parseMediaSessionOpened", () => {
  it("reads the session id out of the hub's answer", () => {
    expect(parseMediaSessionOpened({ sessionId: "session-1" })).toBe("session-1");
  });

  it("refuses an answer without a session id", () => {
    for (const bad of [undefined, null, "session-1", {}, { sessionId: "" }, { sessionId: 1 }]) {
      expect(parseMediaSessionOpened(bad)).toBeNull();
    }
  });
});
