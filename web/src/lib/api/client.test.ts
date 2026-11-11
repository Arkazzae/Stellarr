import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpApiClient } from "./client";
import { ApiError } from "./errors";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BOOTSTRAP = {
  user: {
    id: "u-1",
    username: "patryk",
    displayName: "Patryk",
    avatarColor: "#abc",
    presence: "online",
  },
  server: {
    id: "s-1",
    name: "Orbit",
    description: "Prywatna przestrzeń.",
    iconUrl: "/assets/server-icon",
    createdAt: "2026-07-12T12:00:00Z",
    isPublic: true,
  },
  // Deliberately out of order to prove the client sorts by position.
  channels: [
    { id: "c-2", name: "Salon", kind: "voice", position: 2 },
    { id: "c-1", name: "general", kind: "text", position: 1 },
  ],
  sections: [{ id: "sec-1", name: "Ogłoszenia", position: 0 }],
  members: [
    {
      id: "u-1",
      username: "patryk",
      displayName: "Patryk",
      avatarColor: "#abc",
      presence: "online",
    },
  ],
  messages: [
    {
      id: "m-1",
      channelId: "c-1",
      author: { id: "u-1", username: "patryk", displayName: "Patryk" },
      content: "cześć",
      createdAt: "2026-08-10T19:00:00Z",
      attachments: [],
    },
  ],
  channelReads: { "c-1": "2026-08-10T18:55:00Z" },
  voice: { "c-2": [] },
  rtc: {
    protocolVersion: 1,
    capabilities: {
      audioCodecs: ["opus"],
      videoCodecs: ["vp9", "vp8", "h264"],
      audioProcessing: ["browser", "rnnoise"],
      camera: true,
      screenShare: true,
      screenAudio: true,
    },
    signalingHub: "/hubs/app",
    mediaServer: "",
    iceServers: [
      { urls: ["stun:example.org:3478"], username: null, credential: null },
      {
        urls: ["turn:example.org:3478?transport=udp"],
        username: "u",
        credential: "c",
      },
    ],
  },
};

const ACCOUNT = {
  id: "u-1",
  username: "patryk",
  displayName: "Patryk",
  createdAt: "2026-01-01T00:00:00Z",
  avatarUrl: null,
  bannerUrl: "/assets/banner",
  customStatus: "🎧 na słuchawkach",
  bio: "Hej",
  pronouns: "on/jego",
  preferences: {
    desktopNotifications: true,
    emailNotifications: false,
    pushNotifications: false,
    mentionsOnly: true,
    messageSound: false,
    joinLeaveSound: true,
    allowDirectMessages: true,
    allowFriendRequests: true,
    showPresence: true,
    developerMode: false,
    reducedMotion: true,
    mutedChannelIds: ["c-quiet"],
    vadSensitivity: 60,
  },
};

describe("http api client", () => {
  const api = createHttpApiClient();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts login to a relative URL with same-origin credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "u-1",
        username: "patryk",
        displayName: "Patryk",
        presence: "online",
      }),
    );

    const user = await api.login({ username: "patryk", password: "x" });

    expect(user.displayName).toBe("Patryk");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/login");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.body).toBe(JSON.stringify({ username: "patryk", password: "x" }));
  });

  it("parses and mutates the private cursor-paged notification inbox", async () => {
    const item = {
      id: "notification-1",
      sequence: 8,
      title: "Release ready",
      body: "A release is ready to review.",
      tone: "success",
      source: {
        type: "sdk",
        packageId: "dev.stellarr.releases",
        packageName: "Releases",
        moduleId: "alerts",
        moduleName: "Alerts",
      },
      target: { type: "channel", channelId: "channel-1" },
      createdAt: "2026-08-23T12:00:00Z",
      readAt: null,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        items: [item],
        nextBeforeSequence: 8,
        unreadCount: 1,
        lastSequence: 8,
      }))
      .mockResolvedValueOnce(jsonResponse({ ...item, readAt: "2026-08-23T12:01:00Z" }))
      .mockResolvedValueOnce(jsonResponse({ changed: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.listNotifications({ beforeSequence: 9, limit: 1 })).resolves.toEqual({
      items: [{
        id: item.id,
        sequence: item.sequence,
        title: item.title,
        body: item.body,
        tone: "success",
        source: { ...item.source, type: "sdk" },
        target: { ...item.target, type: "channel" },
        createdAt: item.createdAt,
      }],
      nextBeforeSequence: 8,
      unreadCount: 1,
      lastSequence: 8,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/notifications?beforeSequence=9&limit=1",
    );

    await expect(api.markNotificationRead("notification-1")).resolves.toMatchObject({
      id: "notification-1",
      readAt: "2026-08-23T12:01:00Z",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    await expect(api.markAllNotificationsRead()).resolves.toBe(1);
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
    await expect(api.deleteNotification("notification-1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("DELETE");
  });

  it("rejects an inbox row with an untrusted notification tone", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      items: [{
        id: "notification-1",
        sequence: 1,
        title: "Unsafe",
        body: "Body",
        tone: "script",
        source: {
          type: "sdk",
          packageId: "dev.bad",
          packageName: "Bad",
          moduleId: "bad",
          moduleName: "Bad",
        },
        target: null,
        createdAt: "2026-08-23T12:00:00Z",
        readAt: null,
      }],
      nextBeforeSequence: null,
      unreadCount: 1,
      lastSequence: 1,
    }));

    await expect(api.listNotifications()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("parses a system server-invite notification target", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      items: [{
        id: "invite-1",
        sequence: 9,
        title: "Server invitation",
        body: "Maja invited you to Nebula.",
        tone: "info",
        source: {
          type: "system",
          packageId: "stellarr.server-invite",
          packageName: "Nebula",
          moduleId: "server-invite",
          moduleName: "Maja",
        },
        target: {
          type: "server-invite",
          inviteCode: "join-me",
          serverId: "server-2",
          serverName: "Nebula",
          invitedByName: "Maja",
        },
        createdAt: "2026-08-23T12:00:00Z",
        readAt: null,
      }],
      nextBeforeSequence: null,
      unreadCount: 1,
      lastSequence: 9,
    }));

    await expect(api.listNotifications()).resolves.toMatchObject({
      items: [{
        source: { type: "system" },
        target: { type: "server-invite", inviteCode: "join-me" },
      }],
    });
  });

  it("lists, uploads and deletes custom emoji through the persisted API", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          { id: "e-1", shortcode: ":mushris:", glyph: "/api/emoji/e-1/image" },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { id: "e-2", shortcode: ":pepe:", glyph: "/api/emoji/e-2/image" },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.listEmoji()).resolves.toEqual([
      { id: "e-1", shortcode: ":mushris:", glyph: "/api/emoji/e-1/image" },
    ]);

    const file = new File(["png"], "pepe.png", { type: "image/png" });
    await expect(api.uploadEmoji("pepe", file)).resolves.toMatchObject({ id: "e-2" });
    const [, upload] = fetchMock.mock.calls[1] ?? [];
    expect(upload?.body).toBeInstanceOf(FormData);
    expect((upload?.body as FormData).get("shortcode")).toBe("pepe");
    const uploadedFile = (upload?.body as FormData).get("file");
    expect(uploadedFile).toBeInstanceOf(File);
    expect((uploadedFile as File).name).toBe("pepe.png");

    await expect(api.deleteEmoji("e-2")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/emoji/e-2");
  });

  it("uploads and removes the server icon through the admin API", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ iconUrl: "/assets/server-icon" }, 201),
      )
      .mockResolvedValueOnce(jsonResponse({ iconUrl: null }));

    const file = new File(["png"], "server.png", { type: "image/png" });
    await expect(api.uploadServerIcon(file)).resolves.toBe(
      "/assets/server-icon",
    );

    const [uploadUrl, upload] = fetchMock.mock.calls[0] ?? [];
    expect(uploadUrl).toBe("/api/admin/server/icon");
    expect(upload?.method).toBe("POST");
    expect(upload?.body).toBeInstanceOf(FormData);
    const uploadedFile = (upload?.body as FormData).get("file");
    expect(uploadedFile).toBeInstanceOf(File);
    expect(uploadedFile).toMatchObject({ name: "server.png", type: "image/png" });

    await expect(api.removeServerIcon()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/server/icon");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("updates the persisted server profile", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "s-1",
        name: "Nowa Orbita",
        description: "Opis",
        iconUrl: null,
        createdAt: "2026-07-12T12:00:00Z",
        isPublic: true,
      }),
    );

    await expect(
      api.updateServer({ name: "Nowa Orbita", description: "Opis", isPublic: true }),
    ).resolves.toMatchObject({ name: "Nowa Orbita", isPublic: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/server");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
  });

  it("lists bans and sends persisted kick, ban and unban mutations", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            userId: "u-2",
            displayName: "Spam",
            bannedByName: "Maja",
            reason: "reklamy",
            bannedAt: "2026-08-15T10:00:00Z",
          },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({}, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.listBans()).resolves.toEqual([
      {
        userId: "u-2",
        displayName: "Spam",
        bannedByName: "Maja",
        reason: "reklamy",
        bannedAt: "2026-08-15T10:00:00Z",
      },
    ]);
    await api.kickMember("u-2");
    await api.kickVoiceMember("voice-1", "u-2");
    await api.moveVoiceMember("voice-1", "voice-2", "u-2");
    await api.banMember("u-3", "spam");
    await api.unbanMember("u-3");

    expect(fetchMock.mock.calls.slice(1).map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/admin/members/u-2", "DELETE"],
      ["/api/admin/channels/voice-1/members/u-2", "DELETE"],
      ["/api/admin/channels/voice-1/members/u-2", "PATCH"],
      ["/api/admin/members/u-3/ban", "POST"],
      ["/api/admin/bans/u-3", "DELETE"],
    ]);
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(
      JSON.stringify({ targetChannelId: "voice-2" }),
    );
    expect(fetchMock.mock.calls[4]?.[1]?.body).toBe(JSON.stringify({ reason: "spam" }));
  });

  describe("session contract", () => {
    it("reads 200 with an explicit null user as anonymous", async () => {
      // The public contract: a fresh visitor gets a clean 200, which is why
      // /login no longer logs a failed request in the console.
      fetchMock.mockResolvedValue(jsonResponse({ user: null }));
      await expect(api.session()).resolves.toBeNull();
    });

    it("reads 200 with a user as signed in", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          user: {
            id: "u-1",
            username: "patryk",
            displayName: "Patryk",
            avatarColor: "#abc",
            presence: "online",
          },
        }),
      );
      await expect(api.session()).resolves.toMatchObject({
        id: "u-1",
        displayName: "Patryk",
      });
    });

    it("still reads a legacy 401 as anonymous", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
      await expect(api.session()).resolves.toBeNull();
    });

    it("accepts a bare user object from an older API", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: "u-1",
          username: "patryk",
          displayName: "Patryk",
          presence: "online",
        }),
      );
      await expect(api.session()).resolves.toMatchObject({ id: "u-1" });
    });

    it("reads a bare null body as anonymous", async () => {
      fetchMock.mockResolvedValue(jsonResponse(null));
      await expect(api.session()).resolves.toBeNull();
    });

    it("still fails loudly on a real server error", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
      await expect(api.session()).rejects.toMatchObject({ kind: "server" });
    });
  });

  it("maps HTTP statuses onto actionable error kinds", async () => {
    const cases: Array<[number, string]> = [
      [400, "invalid"],
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not-found"],
      [429, "rate-limited"],
      [500, "server"],
    ];
    for (const [status, kind] of cases) {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      await expect(api.bootstrap()).rejects.toMatchObject({ kind });
    }
  });

  it("reports a dead network as a network error rather than crashing", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.bootstrap()).rejects.toBeInstanceOf(ApiError);
    await expect(api.bootstrap()).rejects.toMatchObject({ kind: "network" });
  });

  it("parses the bootstrap payload the server actually sends", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...BOOTSTRAP,
        channels: BOOTSTRAP.channels.map((channel) =>
          channel.id === "c-2"
            ? { ...channel, audioProfile: "studio" }
            : channel,
        ),
      }),
    );

    const data = await api.bootstrap();

    expect(data.server.name).toBe("Orbit");
    expect(data.server.iconUrl).toBe("/assets/server-icon");
    expect(data.server.createdAt).toBe("2026-07-12T12:00:00Z");
    expect(data.server.isPublic).toBe(true);
    expect(data.user.presence).toBe("online");
    // Sorted by position, so #general leads the rail.
    expect(data.channels.map((channel) => channel.name)).toEqual([
      "general",
      "Salon",
    ]);
    expect(data.channels.find((channel) => channel.id === "c-2")?.audioProfile).toBe(
      "studio",
    );
    expect(data.messages[0]?.content).toBe("cześć");
    expect(data.voice).toEqual({ "c-2": [] });
    expect(data.channelReads).toEqual({ "c-1": "2026-08-10T18:55:00Z" });
  });

  it("updates a voice channel's audio profile", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "c-2",
        name: "Salon",
        kind: "voice",
        position: 2,
        audioProfile: "studio",
      }),
    );

    await expect(
      api.updateChannel("c-2", { audioProfile: "studio" }),
    ).resolves.toMatchObject({ id: "c-2", audioProfile: "studio" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/channels/c-2");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ audioProfile: "studio" }));
  });

  it("keeps the server-issued TURN credentials intact", async () => {
    fetchMock.mockResolvedValue(jsonResponse(BOOTSTRAP));

    const { rtc } = await api.bootstrap();

    expect(rtc?.protocolVersion).toBe(1);
    expect(rtc?.capabilities.audioCodecs).toEqual(["opus"]);
    expect(rtc?.iceServers).toEqual([
      { urls: ["stun:example.org:3478"] },
      {
        urls: ["turn:example.org:3478?transport=udp"],
        username: "u",
        credential: "c",
      },
    ]);
  });

  it("does not disguise an unknown RTC contract as v1", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...BOOTSTRAP,
        rtc: {
          ...BOOTSTRAP.rtc,
          protocolVersion: undefined,
        },
      }),
    );

    const { rtc } = await api.bootstrap();

    expect(rtc?.protocolVersion).toBe(0);
  });

  it("rejects a payload that is missing required fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ server: {}, channels: [] }));
    await expect(api.bootstrap()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("accepts a message either bare or in a single-key envelope", async () => {
    const message = {
      id: "m-2",
      channelId: "c-1",
      author: { id: "u-1", displayName: "Patryk" },
      content: "hej",
      createdAt: "2026-08-10T19:05:00Z",
      attachments: [],
    };

    fetchMock.mockResolvedValueOnce(jsonResponse(message, 201));
    await expect(
      api.sendMessage("c-1", { content: "hej", attachmentIds: [] }),
    ).resolves.toMatchObject({ id: "m-2" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ message }, 201));
    await expect(
      api.sendMessage("c-1", { content: "hej", attachmentIds: [] }),
    ).resolves.toMatchObject({ id: "m-2" });
  });

  it("sends the stable client message id used for retries", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "1f62f866-0194-4f0b-b993-4e9d4821acdc",
        channelId: "c-1",
        author: { id: "u-1", displayName: "Patryk" },
        content: "hej",
        createdAt: "2026-08-10T19:05:00Z",
        attachments: [],
      }, 201),
    );

    await api.sendMessage("c-1", {
      content: "hej",
      attachmentIds: [],
      clientMessageId: "1f62f866-0194-4f0b-b993-4e9d4821acdc",
    });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      content: "hej",
      attachmentIds: [],
      clientMessageId: "1f62f866-0194-4f0b-b993-4e9d4821acdc",
    }));
  });

  it("parses persisted replies and reactions", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "m-reply",
        channelId: "c-1",
        author: { id: "u-2", displayName: "Ada" },
        content: "odpowiedź",
        createdAt: "2026-08-10T19:05:00Z",
        attachments: [],
        embeds: [],
        replyTo: {
          id: "m-root",
          authorId: "u-1",
          authorName: "Maja",
          preview: "początek",
          hasAttachment: false,
        },
        reactions: [{ emoji: "👍", count: 2, mine: true }],
      }),
    );

    const message = await api.sendMessage("c-1", {
      content: "odpowiedź",
      attachmentIds: [],
      replyToMessageId: "m-root",
    });

    expect(message.replyTo).toMatchObject({ id: "m-root", authorName: "Maja" });
    expect(message.reactions).toEqual([{ emoji: "👍", count: 2, mine: true }]);
  });

  it("persists and removes an encoded reaction", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        messageId: "m/1",
        channelId: "c-1",
        emoji: "👍",
        count: 1,
        userId: "u-1",
        added: true,
      }),
    );

    await expect(api.setMessageReaction("m/1", "👍", true)).resolves.toMatchObject({
      messageId: "m/1",
      count: 1,
      added: true,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/messages/m%2F1/reactions/%F0%9F%91%8D",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
  });

  it("loads a cursor page for a channel and preserves the paging token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        messages: [
          {
            id: "m-older",
            channelId: "a/b",
            author: { id: "u-1", displayName: "Patryk" },
            content: "starsza",
            createdAt: "2026-08-10T18:00:00Z",
            attachments: [],
            embeds: [],
          },
        ],
        nextCursor: "opaque+/=",
      }),
    );

    const page = await api.listMessages("a/b", {
      cursor: "previous+/=",
      limit: 25,
    });

    expect(page).toMatchObject({
      messages: [{ id: "m-older", content: "starsza" }],
      nextCursor: "opaque+/=",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/channels/a%2Fb/messages?cursor=previous%2B%2F%3D&limit=25",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("marks a channel read through the persisted endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ channelId: "a/b", lastReadAt: "2026-08-10T19:10:00Z" }),
    );

    await expect(api.markChannelRead("a/b")).resolves.toEqual({
      channelId: "a/b",
      lastReadAt: "2026-08-10T19:10:00Z",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/channels/a%2Fb/read");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
  });

  it("parses durable message changes after a reconnect", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      changes: [
        {
          cursor: "42",
          kind: "delete",
          messageId: "m-missed",
          message: null,
        },
      ],
      nextCursor: "42",
      hasMore: false,
      resetRequired: false,
    }));

    await expect(api.syncMessages("a/b", "41")).resolves.toEqual({
      changes: [{ cursor: "42", kind: "delete", messageId: "m-missed" }],
      nextCursor: "42",
      hasMore: false,
      resetRequired: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/channels/a%2Fb/messages/sync?after=41",
    );
  });

  it("sends an upload as multipart under the field name the server reads", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: "a-1",
          name: "moon.png",
          contentType: "image/png",
          size: 10,
          width: 800,
          height: 600,
          url: "/assets/a-1",
        },
        201,
      ),
    );

    const file = new File(["x"], "moon.png", { type: "image/png" });
    const attachment = await api.uploadAttachment(file);

    expect(attachment).toMatchObject({
      id: "a-1",
      url: "/assets/a-1",
      width: 800,
      height: 600,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/uploads/images");
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("sends and reads measured video metadata", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: "a-video",
          name: "clip.mp4",
          contentType: "video/mp4",
          size: 10,
          width: 1920,
          height: 1080,
          durationSeconds: 42.125,
          url: "/assets/a-video",
          posterUrl: "/assets/a-video/poster",
        },
        201,
      ),
    );

    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const poster = new Blob(["poster"], { type: "image/jpeg" });
    const attachment = await api.uploadAttachment(file, {
      width: 1920,
      height: 1080,
      durationSeconds: 42.125,
      poster,
    });

    expect(attachment).toMatchObject({
      width: 1920,
      height: 1080,
      durationSeconds: 42.125,
      posterUrl: "/assets/a-video/poster",
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("durationSeconds")).toBe("42.125");
    expect(body.get("width")).toBe("1920");
    expect(body.get("height")).toBe("1080");
    expect(body.get("poster")).toBeInstanceOf(File);
  });

  it("marks an uploaded recording as a voice message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: "a-voice",
          name: "wiadomosc-glosowa.webm",
          contentType: "audio/webm",
          size: 512,
          durationSeconds: 3.25,
          isVoiceMessage: true,
          url: "/assets/a-voice",
        },
        201,
      ),
    );

    const file = new File(["voice"], "wiadomosc-glosowa.webm", {
      type: "audio/webm",
    });
    const attachment = await api.uploadAttachment(file, {
      durationSeconds: 3.25,
      voiceMessage: true,
    });

    expect(attachment).toMatchObject({
      durationSeconds: 3.25,
      isVoiceMessage: true,
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("durationSeconds")).toBe("3.25");
    expect(body.get("voiceMessage")).toBe("true");
  });

  it("escapes the channel id in the message URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: "m-3",
          channelId: "a/b",
          author: { id: "u-1", displayName: "P" },
          content: "",
          createdAt: "2026-08-10T19:05:00Z",
          attachments: [],
        },
        201,
      ),
    );

    await api.sendMessage("a/b", { content: "", attachmentIds: [] });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/channels/a%2Fb/messages");
  });

  it("reads and updates the private account contract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ACCOUNT));
    await expect(api.getAccount()).resolves.toMatchObject({
      displayName: "Patryk",
      customStatus: "🎧 na słuchawkach",
      bio: "Hej",
      preferences: {
        messageSound: false,
        reducedMotion: true,
        mutedChannelIds: ["c-quiet"],
      },
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...ACCOUNT, displayName: "Pati" }),
    );
    await api.updateAccount({
      displayName: "Pati",
      customStatus: "☕ przerwa",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/me");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ displayName: "Pati", customStatus: "☕ przerwa" }),
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...ACCOUNT.preferences, messageSound: true }),
    );
    await expect(api.updatePreferences({ messageSound: true })).resolves.toMatchObject({
      messageSound: true,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/me/preferences");
  });

  it("uses dedicated password and profile-image endpoints", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: "wrong-current" }));
    await expect(api.changePassword("old", "new-password")).resolves.toBe(
      "wrong-current",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...ACCOUNT, avatarUrl: "/assets/avatar" }, 201),
    );
    const file = new File(["image"], "avatar.png", { type: "image/png" });
    await expect(api.uploadAccountImage("avatar", file)).resolves.toMatchObject({
      avatarUrl: "/assets/avatar",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/me/images/avatar");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData);

    fetchMock.mockResolvedValueOnce(jsonResponse(ACCOUNT));
    await api.removeAccountImage("avatar");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/me/images/avatar");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });
});
