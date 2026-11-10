import { describe, expect, it } from "vitest";

import {
  parseAuditEntry,
  parseBootstrap,
  parseChannel,
  parseCustomEmoji,
  parseInvite,
  parseJoinSoundLibrary,
  parseNotificationSettings,
  parsePermissionOverride,
  parseRole,
  parseSection,
  parseServer,
  parseServerBan,
  parseServerMember,
  parseSoundboardSettings,
  parseSoundboardSnapshot,
  parseSoundboardSound,
} from "./directoryParsers";

function expectMalformed(action: () => unknown): void {
  expect(action).toThrow(expect.objectContaining({ name: "ApiError", kind: "malformed" }));
}

const USER = { id: "u-1", username: "maja", displayName: "Maja", presence: "online" };
const SERVER = { id: "srv-1", name: "Orbit" };
const SOUND = {
  id: "s-1",
  name: "Gong",
  glyph: "🔔",
  url: "/assets/s-1",
  durationSeconds: 2,
  trimStartSeconds: 0,
  trimEndSeconds: 2,
};

describe("parseServer", () => {
  it("reads a server and treats a missing public flag as private", () => {
    expect(parseServer(SERVER)).toStrictEqual({ ...SERVER, isPublic: false });
  });

  it("keeps the description, icon and creation time only when present", () => {
    expect(
      parseServer({
        ...SERVER,
        description: "Prywatna przestrzeń.",
        iconUrl: "/assets/server-icon",
        createdAt: "2026-07-12T12:00:00Z",
        isPublic: true,
      }),
    ).toStrictEqual({
      ...SERVER,
      description: "Prywatna przestrzeń.",
      iconUrl: "/assets/server-icon",
      createdAt: "2026-07-12T12:00:00Z",
      isPublic: true,
    });
  });

  it("requires an id and a name", () => {
    expectMalformed(() => parseServer({ name: "Orbit" }));
    expectMalformed(() => parseServer({ id: "srv-1" }));
    expectMalformed(() => parseServer([]));
  });
});

describe("parseChannel", () => {
  it("reads a text channel by default", () => {
    expect(parseChannel({ id: "c-1", name: "general" }, "/p")).toStrictEqual({
      id: "c-1",
      name: "general",
      kind: "text",
    });
  });

  it("reads the settings of a voice channel", () => {
    expect(
      parseChannel(
        {
          id: "c-2",
          name: "Salon",
          kind: "voice",
          position: 2,
          userLimit: 8,
          audioProfile: "studio",
          sectionId: "sec-1",
          topic: "Rozmowy",
          slowModeSeconds: 5,
          hideAfterInactivityHours: 24,
        },
        "/p",
      ),
    ).toStrictEqual({
      id: "c-2",
      name: "Salon",
      kind: "voice",
      position: 2,
      userLimit: 8,
      audioProfile: "studio",
      sectionId: "sec-1",
      topic: "Rozmowy",
      slowModeSeconds: 5,
      hideAfterInactivityHours: 24,
    });
  });

  it("drops an audio profile it does not know", () => {
    const channel = parseChannel({ id: "c-2", name: "Salon", kind: "voice", audioProfile: "lossless" }, "/p");

    expect("audioProfile" in channel).toBe(false);
  });

  it("requires an id and a name", () => {
    expectMalformed(() => parseChannel({ name: "general" }, "/p"));
    expectMalformed(() => parseChannel({ id: "c-1" }, "/p"));
  });
});

describe("parseSection", () => {
  it("defaults the position to the top", () => {
    expect(parseSection({ id: "sec-1", name: "Ogłoszenia" }, "/p")).toStrictEqual({
      id: "sec-1",
      name: "Ogłoszenia",
      position: 0,
    });
    expect(parseSection({ id: "sec-1", name: "Ogłoszenia", position: 3 }, "/p").position).toBe(3);
  });

  it("requires an id and a name", () => {
    expectMalformed(() => parseSection({ id: "sec-1" }, "/p"));
  });
});

describe("permissions", () => {
  it("keeps only the permissions this client can name", () => {
    expect(
      parsePermissionOverride(
        {
          roleId: "r-1",
          allow: ["manageMessages", "teleport", 3],
          deny: ["manageChannels"],
        },
        "/p",
      ),
    ).toStrictEqual({
      roleId: "r-1",
      allow: ["manageMessages"],
      deny: ["manageChannels"],
    });
  });

  it("reads missing lists as empty, and requires the role", () => {
    expect(parsePermissionOverride({ roleId: "r-1" }, "/p")).toStrictEqual({
      roleId: "r-1",
      allow: [],
      deny: [],
    });
    expectMalformed(() => parsePermissionOverride({ allow: [] }, "/p"));
  });
});

describe("parseRole", () => {
  it("reads a role", () => {
    expect(
      parseRole(
        {
          id: "r-1",
          name: "Moderator",
          color: "#3366ff",
          permissions: ["manageMessages", "moderateMembers"],
          memberCount: 4,
          isSystem: true,
          isOwner: false,
        },
        "/p",
      ),
    ).toStrictEqual({
      id: "r-1",
      name: "Moderator",
      color: "#3366ff",
      permissions: ["manageMessages", "moderateMembers"],
      memberCount: 4,
      isSystem: true,
      isOwner: false,
    });
  });

  it("defaults the counters and flags and requires a colour", () => {
    expect(parseRole({ id: "r-1", name: "Gość", color: "#000" }, "/p")).toStrictEqual({
      id: "r-1",
      name: "Gość",
      color: "#000",
      permissions: [],
      memberCount: 0,
      isSystem: false,
      isOwner: false,
    });
    expectMalformed(() => parseRole({ id: "r-1", name: "Gość" }, "/p"));
  });
});

describe("parseServerMember and parseServerBan", () => {
  it("read a member with their role", () => {
    expect(
      parseServerMember({ user: USER, roleId: "r-1", joinedAt: "2026-01-01T00:00:00Z" }, "/p[]"),
    ).toStrictEqual({ user: USER, roleId: "r-1", joinedAt: "2026-01-01T00:00:00Z" });
    expectMalformed(() => parseServerMember({ user: USER, roleId: "r-1" }, "/p[]"));
    expectMalformed(() => parseServerMember({ roleId: "r-1", joinedAt: "x" }, "/p[]"));
  });

  it("read a ban with who issued it and why", () => {
    const ban = {
      userId: "u-3",
      displayName: "Troll",
      bannedByName: "Maja",
      reason: "Spam",
      bannedAt: "2026-01-02T00:00:00Z",
    };

    expect(parseServerBan(ban, "/p[]")).toStrictEqual(ban);
    expectMalformed(() => parseServerBan({ ...ban, reason: undefined }, "/p[]"));
  });
});

describe("invites, audit entries, emoji and notification settings", () => {
  it("reads an invite, with no limits when none are set", () => {
    const invite = { id: "i-1", url: "https://stellarr.example/i/abc", createdByName: "Maja" };

    expect(parseInvite(invite, "/p")).toStrictEqual({
      ...invite,
      uses: 0,
      maxUses: null,
      expiresAt: null,
    });
    expect(
      parseInvite({ ...invite, uses: 2, maxUses: 5, expiresAt: "2026-02-01T00:00:00Z" }, "/p"),
    ).toMatchObject({ uses: 2, maxUses: 5, expiresAt: "2026-02-01T00:00:00Z" });
    expectMalformed(() => parseInvite({ id: "i-1", url: "x" }, "/p"));
  });

  it("reads an audit entry", () => {
    const entry = { id: "a-1", summary: "Maja utworzyła kanał", at: "2026-01-01T00:00:00Z" };

    expect(parseAuditEntry(entry, "/p")).toStrictEqual(entry);
    expectMalformed(() => parseAuditEntry({ id: "a-1", summary: "x" }, "/p"));
  });

  it("reads a custom emoji", () => {
    const emoji = { id: "e-1", shortcode: "kot", glyph: "/assets/e-1" };

    expect(parseCustomEmoji(emoji, "/p")).toStrictEqual(emoji);
    expectMalformed(() => parseCustomEmoji({ id: "e-1", shortcode: "kot" }, "/p"));
  });

  it("reads notification settings, treating anything but true as off", () => {
    expect(
      parseNotificationSettings(
        { allMessages: true, mentionsOnly: "yes", voiceJoinSound: true, mutedChannelIds: ["c-1", 2] },
        "/p",
      ),
    ).toStrictEqual({
      allMessages: true,
      mentionsOnly: false,
      voiceJoinSound: true,
      mutedChannelIds: ["c-1"],
      serverMuted: false,
    });
  });
});

describe("soundboard", () => {
  it("reads a sound with its trim", () => {
    expect(parseSoundboardSound(SOUND)).toStrictEqual(SOUND);
  });

  it("requires the measured durations to be finite numbers", () => {
    expectMalformed(() => parseSoundboardSound({ ...SOUND, durationSeconds: "2" }));
    expectMalformed(() => parseSoundboardSound({ ...SOUND, trimEndSeconds: Number.NaN }));
    expectMalformed(() => parseSoundboardSound({ ...SOUND, url: undefined }));
  });

  it("reads settings, treating anything but true as off", () => {
    expect(parseSoundboardSettings({ everyoneCanPlay: true }, "/p")).toStrictEqual({
      everyoneCanPlay: true,
      rateLimited: false,
    });
  });

  it("reads the whole snapshot", () => {
    expect(
      parseSoundboardSnapshot(
        { sounds: [SOUND], settings: { everyoneCanPlay: true, rateLimited: true }, canManage: true },
        "/p",
      ),
    ).toStrictEqual({
      sounds: [SOUND],
      settings: { everyoneCanPlay: true, rateLimited: true },
      canManage: true,
    });
    expectMalformed(() => parseSoundboardSnapshot({ settings: {} }, "/p"));
    expectMalformed(() => parseSoundboardSnapshot({ sounds: [], canManage: false }, "/p"));
  });
});

describe("parseJoinSoundLibrary", () => {
  it("reads the sounds on offer, grouped by server", () => {
    expect(
      parseJoinSoundLibrary(
        {
          maxSeconds: 4,
          selectedId: "s-1",
          servers: [
            { serverId: "srv-1", serverName: "Orbit", iconUrl: "/i", sounds: [SOUND] },
            { serverId: "srv-2", serverName: "Lagoon", sounds: [] },
          ],
        },
        "/p",
      ),
    ).toStrictEqual({
      maxSeconds: 4,
      selectedId: "s-1",
      servers: [
        { serverId: "srv-1", serverName: "Orbit", iconUrl: "/i", sounds: [SOUND] },
        { serverId: "srv-2", serverName: "Lagoon", sounds: [] },
      ],
    });
  });

  it("defaults to a five second window with the chime selected", () => {
    expect(parseJoinSoundLibrary({ servers: [] }, "/p")).toStrictEqual({
      maxSeconds: 5,
      selectedId: null,
      servers: [],
    });
  });

  it("requires the server groups", () => {
    expectMalformed(() => parseJoinSoundLibrary({}, "/p"));
    expectMalformed(() => parseJoinSoundLibrary({ servers: [{ serverId: "srv-1" }] }, "/p"));
  });
});

describe("parseBootstrap", () => {
  const bootstrap = {
    user: USER,
    server: SERVER,
    channels: [],
    sections: [],
    members: [USER],
  };

  it("reads the minimum a fresh server sends", () => {
    expect(parseBootstrap(bootstrap)).toStrictEqual({
      user: USER,
      server: { ...SERVER, isPublic: false },
      servers: [{ ...SERVER, isPublic: false }],
      channels: [],
      sections: [],
      members: [USER],
      permissions: [],
      messages: [],
    });
  });

  it("lists every server of the account when the server names them", () => {
    const parsed = parseBootstrap({
      ...bootstrap,
      servers: [SERVER, { id: "srv-2", name: "Lagoon", isPublic: true }],
    });

    expect(parsed.servers.map((server) => server.id)).toEqual(["srv-1", "srv-2"]);
  });

  it("puts channels and sections in the order the server defined", () => {
    const parsed = parseBootstrap({
      ...bootstrap,
      channels: [
        { id: "c-3", name: "last", position: 3 },
        { id: "c-0", name: "unplaced" },
        { id: "c-1", name: "first", position: 1 },
      ],
      sections: [
        { id: "sec-2", name: "B", position: 2 },
        { id: "sec-1", name: "A", position: 1 },
      ],
    });

    expect(parsed.channels.map((channel) => channel.id)).toEqual(["c-0", "c-1", "c-3"]);
    expect(parsed.sections.map((section) => section.id)).toEqual(["sec-1", "sec-2"]);
  });

  it("reads the effective permissions and the recent messages", () => {
    const parsed = parseBootstrap({
      ...bootstrap,
      permissions: ["manageServer", "unknown"],
      messages: [
        { id: "m-1", channelId: "c-1", author: { id: "u-1" }, content: "Hej" },
      ],
    });

    expect(parsed.permissions).toEqual(["manageServer"]);
    expect(parsed.messages[0]?.content).toBe("Hej");
  });

  it("keeps the read watermarks that are timestamps", () => {
    const parsed = parseBootstrap({
      ...bootstrap,
      channelReads: { "c-1": "2026-01-01T00:00:00Z", "c-2": 5, "c-3": null },
    });

    expect(parsed.channelReads).toEqual({ "c-1": "2026-01-01T00:00:00Z" });
  });

  it("hands the voice occupants to the UI as the server sent them", () => {
    const voice = {
      "c-2": [
        { userId: "u-1", displayName: "Maja", muted: true, deafened: false },
        { userId: "u-2" },
      ],
      "c-3": [],
    };

    expect(parseBootstrap({ ...bootstrap, voice }).voice).toStrictEqual(voice);
  });

  it("leaves the voice map out when it is not an object", () => {
    expect("voice" in parseBootstrap({ ...bootstrap, voice: ["c-2"] })).toBe(false);
    expect("voice" in parseBootstrap({ ...bootstrap, voice: null })).toBe(false);
  });

  it("omits what the server did not send", () => {
    const parsed = parseBootstrap(bootstrap);

    expect("channelReads" in parsed).toBe(false);
    expect("voice" in parsed).toBe(false);
    expect("rtc" in parsed).toBe(false);
  });

  it("requires the user, the server and the lists", () => {
    expectMalformed(() => parseBootstrap(null));
    expectMalformed(() => parseBootstrap({ ...bootstrap, user: undefined }));
    expectMalformed(() => parseBootstrap({ ...bootstrap, server: undefined }));
    expectMalformed(() => parseBootstrap({ ...bootstrap, channels: undefined }));
    expectMalformed(() => parseBootstrap({ ...bootstrap, sections: "none" }));
    expectMalformed(() => parseBootstrap({ ...bootstrap, members: undefined }));
  });

  describe("rtc", () => {
    const rtc = {
      protocolVersion: 1,
      topology: "mesh",
      capabilities: {
        audioCodecs: ["opus"],
        videoCodecs: ["vp8", 3],
        audioProcessing: ["rnnoise"],
        camera: true,
        screenShare: true,
        screenAudio: false,
      },
      signalingHub: "/hubs/rtc",
      mediaServer: "wss://sfu.example",
      iceServers: [{ urls: ["stun:stun.example"] }],
    };

    it("keeps the contract the server issued", () => {
      expect(parseBootstrap({ ...bootstrap, rtc }).rtc).toStrictEqual({
        protocolVersion: 1,
        topology: "mesh",
        capabilities: { ...rtc.capabilities, videoCodecs: ["vp8"] },
        signalingHub: "/hubs/rtc",
        mediaServer: "wss://sfu.example",
        iceServers: [{ urls: ["stun:stun.example"] }],
      });
    });

    it("does not disguise a missing contract as v1 mesh", () => {
      const parsed = parseBootstrap({ ...bootstrap, rtc: {} }).rtc;

      expect(parsed).toMatchObject({
        protocolVersion: 0,
        topology: "unknown",
        signalingHub: "/hubs/app",
        mediaServer: "",
        iceServers: [],
      });
      expect(parsed?.capabilities).toStrictEqual({
        audioCodecs: [],
        videoCodecs: [],
        audioProcessing: [],
        camera: false,
        screenShare: false,
        screenAudio: false,
      });
    });

    it("keeps an unrecognised topology as received, so it can be refused later", () => {
      expect(parseBootstrap({ ...bootstrap, rtc: { ...rtc, topology: "quantum" } }).rtc?.topology).toBe(
        "quantum",
      );
    });

    it("reads the older name of the topology", () => {
      const { topology: _topology, ...legacy } = rtc;

      expect(parseBootstrap({ ...bootstrap, rtc: { ...legacy, mode: "sfu" } }).rtc?.topology).toBe(
        "sfu",
      );
    });

    it("treats a protocol version that is not a number as unknown", () => {
      expect(
        parseBootstrap({ ...bootstrap, rtc: { ...rtc, protocolVersion: "1" } }).rtc?.protocolVersion,
      ).toBe(0);
    });

    it("keeps relay credentials only where the server gave them", () => {
      const parsed = parseBootstrap({
        ...bootstrap,
        rtc: {
          ...rtc,
          iceServers: [
            { urls: "turn:turn.example", username: "u", credential: "secret" },
            { urls: ["stun:a.example", "stun:b.example"], username: "", credential: "" },
            { urls: [] },
            { username: "orphan" },
            "stun:bare.example",
          ],
        },
      });

      expect(parsed.rtc?.iceServers).toStrictEqual([
        { urls: ["turn:turn.example"], username: "u", credential: "secret" },
        { urls: ["stun:a.example", "stun:b.example"] },
      ]);
    });
  });
});
