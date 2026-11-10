import { describe, expect, it } from "vitest";

import {
  itAnswersMissingDeletes,
  itForwardsTheSignal,
  itSendsCalls,
  jsonResponse,
  mockFetch,
  sentRequest,
} from "@/test/http";

import { serverCalls } from "./server";

const fetchMock = mockFetch();
const calls = serverCalls();

const SERVER = { id: "s-1", name: "Orbit" };
const SETTINGS = {
  allMessages: false,
  mentionsOnly: true,
  voiceJoinSound: true,
  mutedChannelIds: ["c-1"],
  serverMuted: false,
};

describe("server calls", () => {
  itSendsCalls(fetchMock, [
    { name: "listServers", run: () => calls.listServers(), method: "GET", url: "/api/servers", answer: [SERVER] },
    {
      name: "discoverServers",
      run: () => calls.discoverServers(),
      method: "GET",
      url: "/api/servers/discover",
      answer: [SERVER],
    },
    {
      name: "createServer",
      run: () => calls.createServer({ name: "Orbit", isPublic: true }),
      method: "POST",
      url: "/api/servers",
      body: { name: "Orbit", isPublic: true },
      answer: SERVER,
    },
    {
      name: "joinServer with an id that needs escaping",
      run: () => calls.joinServer("s/1"),
      method: "POST",
      url: "/api/servers/s%2F1/join",
      answer: SERVER,
    },
    {
      name: "joinServerInvite",
      run: () => calls.joinServerInvite("join me"),
      method: "POST",
      url: "/api/invites/join%20me/join",
      answer: SERVER,
    },
    {
      name: "updateServer",
      run: () => calls.updateServer({ description: "Opis" }),
      method: "PATCH",
      url: "/api/admin/server",
      body: { description: "Opis" },
      answer: SERVER,
    },
    {
      name: "removeServerIcon",
      run: () => calls.removeServerIcon(),
      method: "DELETE",
      url: "/api/admin/server/icon",
    },
    {
      name: "transferServer",
      run: () => calls.transferServer("u-2"),
      method: "POST",
      url: "/api/admin/server/transfer",
      body: { userId: "u-2" },
    },
    { name: "deleteServer", run: () => calls.deleteServer(), method: "DELETE", url: "/api/admin/server" },
    {
      name: "listAuditEntries",
      run: () => calls.listAuditEntries(),
      method: "GET",
      url: "/api/admin/audit",
      answer: [{ id: "a-1", summary: "Maja banned Spam", at: "2026-08-15T10:00:00Z" }],
    },
    {
      name: "getNotificationSettings",
      run: () => calls.getNotificationSettings(),
      method: "GET",
      url: "/api/admin/notifications",
      answer: SETTINGS,
    },
    {
      name: "setNotificationSettings",
      run: () => calls.setNotificationSettings({ serverMuted: true }),
      method: "PATCH",
      url: "/api/admin/notifications",
      body: { serverMuted: true },
      answer: SETTINGS,
    },
  ]);

  it("sends the server icon as the file field and returns where it is served", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ iconUrl: "/assets/server-icon" }, 201));

    const url = await calls.uploadServerIcon(new File(["png"], "server.png", { type: "image/png" }));

    expect(url).toBe("/assets/server-icon");
    const sent = sentRequest(fetchMock);
    expect([sent.method, sent.url]).toEqual(["POST", "/api/admin/server/icon"]);
    expect((sent.body as FormData).get("file")).toMatchObject({ name: "server.png" });
  });

  it("rejects an icon answer without an address", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ iconUrl: null }));
    await expect(calls.uploadServerIcon(new File(["png"], "s.png"))).rejects.toMatchObject({
      kind: "malformed",
    });
  });

  it("counts a server that is already gone as deleted", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(calls.deleteServer()).resolves.toBeUndefined();
  });

  itAnswersMissingDeletes(fetchMock, { removeServerIcon: () => calls.removeServerIcon() }, false);

  itForwardsTheSignal(fetchMock, {
    removeServerIcon: (signal) => calls.removeServerIcon(signal),
    deleteServer: (signal) => calls.deleteServer(signal),
  });
});
