import { describe, expect, it, vi } from "vitest";

import { jsonResponse, mockFetch, noContent, sentRequest } from "@/test/http";

import { ACTIVE_SERVER_STORAGE_KEY } from "../transport";
import { sessionCalls } from "./session";

const fetchMock = mockFetch();
const calls = sessionCalls();

const USER = { id: "u-1", username: "patryk", displayName: "Patryk", presence: "online" };
const BOOTSTRAP = {
  user: USER,
  server: { id: "s-2", name: "Orbit" },
  channels: [],
  sections: [],
  members: [USER],
};

describe("signing in and out", () => {
  it("checks whether the instance needs its first server", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ needsServerSetup: true }));
    await expect(calls.needsServerSetup()).resolves.toBe(true);
    expect(sentRequest(fetchMock).url).toBe("/api/auth/registration");
    fetchMock.mockResolvedValue(jsonResponse({ needsServerSetup: "yes" }));
    await expect(calls.needsServerSetup()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("posts the credentials and reads the user from an envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: USER }));

    await expect(calls.register({ username: "patryk", email: "p@example.org", password: "pw", displayName: "P" }))
      .resolves.toMatchObject({ id: "u-1" });

    const sent = sentRequest(fetchMock);
    expect([sent.method, sent.url]).toEqual(["POST", "/api/auth/register"]);
    expect(sent.body).toEqual({
      username: "patryk",
      email: "p@example.org",
      password: "pw",
      displayName: "P",
    });
  });

  it("asks for a password reset and completes it", async () => {
    fetchMock.mockResolvedValue(noContent());

    await calls.requestPasswordReset("a@b.c");
    await calls.resetPassword("token", "new-password");

    expect(sentRequest(fetchMock, 0)).toMatchObject({
      url: "/api/auth/password/forgot",
      body: { email: "a@b.c" },
    });
    expect(sentRequest(fetchMock, 1)).toMatchObject({
      url: "/api/auth/password/reset",
      body: { token: "token", newPassword: "new-password" },
    });
  });

  it("treats a logout the server rejects as signed out", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(calls.logout()).resolves.toBeUndefined();
    expect(sentRequest(fetchMock).method).toBe("POST");
  });

  it("still fails when the server could not log out", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(calls.logout()).rejects.toMatchObject({ kind: "server" });
  });
});

describe("bootstrap", () => {
  it("remembers the server it was answered for", async () => {
    fetchMock.mockResolvedValue(jsonResponse(BOOTSTRAP));

    await calls.bootstrap();

    expect(window.localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY)).toBe("s-2");
  });

  it("sends the remembered server and asks again without it once it is refused", async () => {
    window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, "s-gone");
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse(BOOTSTRAP));

    await expect(calls.bootstrap()).resolves.toMatchObject({ server: { id: "s-2" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentRequest(fetchMock, 0).headers.get("X-Stellarr-Server")).toBe("s-gone");
    expect(sentRequest(fetchMock, 1).headers.has("X-Stellarr-Server")).toBe(false);
    expect(window.localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY)).toBe("s-2");
  });

  it("asks only once more, and reports a second refusal", async () => {
    window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, "s-gone");
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 403 })));

    await expect(calls.bootstrap()).rejects.toMatchObject({ kind: "forbidden" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refusal when no server was remembered", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    await expect(calls.bootstrap()).rejects.toMatchObject({ kind: "forbidden" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures", async () => {
    window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, "s-1");
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(calls.bootstrap()).rejects.toMatchObject({ kind: "server" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still answers when the browser will not store the server", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "QuotaExceededError");
    });
    fetchMock.mockResolvedValue(jsonResponse(BOOTSTRAP));

    await expect(calls.bootstrap()).resolves.toMatchObject({ server: { id: "s-2" } });
  });
});
