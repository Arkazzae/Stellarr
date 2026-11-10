import { describe, expect, it } from "vitest";

import { itSendsCalls, jsonResponse, mockFetch, sentRequest } from "@/test/http";

import { accountCalls } from "./account";

const fetchMock = mockFetch();
const calls = accountCalls();

const ACCOUNT = {
  id: "u-1",
  username: "patryk",
  displayName: "Patryk",
  createdAt: "2026-01-01T00:00:00Z",
  preferences: {},
};

describe("account calls", () => {
  itSendsCalls(fetchMock, [
    { name: "getAccount", run: () => calls.getAccount(), method: "GET", url: "/api/me", answer: ACCOUNT },
    {
      name: "updateAccount",
      run: () => calls.updateAccount({ displayName: "Pati" }),
      method: "PATCH",
      url: "/api/me",
      body: { displayName: "Pati" },
      answer: ACCOUNT,
    },
    {
      name: "updatePreferences",
      run: () => calls.updatePreferences({ messageSound: false }),
      method: "PATCH",
      url: "/api/me/preferences",
      body: { messageSound: false },
      answer: {},
    },
    {
      name: "getJoinSoundLibrary",
      run: () => calls.getJoinSoundLibrary(),
      method: "GET",
      url: "/api/me/join-sound",
      answer: { maxSeconds: 5, selectedId: null, servers: [] },
    },
    {
      name: "changePassword",
      run: () => calls.changePassword("old", "new-password"),
      method: "POST",
      url: "/api/me/password",
      body: { currentPassword: "old", newPassword: "new-password" },
      answer: { result: "changed" },
    },
    {
      name: "removeAccountImage",
      run: () => calls.removeAccountImage("banner"),
      method: "DELETE",
      url: "/api/me/images/banner",
      answer: ACCOUNT,
    },
  ]);

  it("uploads a profile image under the file field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...ACCOUNT, bannerUrl: "/assets/banner" }, 201));

    await expect(
      calls.uploadAccountImage("banner", new File(["img"], "banner.png", { type: "image/png" })),
    ).resolves.toMatchObject({ bannerUrl: "/assets/banner" });

    const sent = sentRequest(fetchMock);
    expect([sent.method, sent.url]).toEqual(["POST", "/api/me/images/banner"]);
    expect((sent.body as FormData).get("file")).toMatchObject({ name: "banner.png" });
  });

  it("reports a refused password change as an answer, not as an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: "wrong-current" }));
    await expect(calls.changePassword("old", "new-password")).resolves.toBe("wrong-current");
  });

  it("rejects a password answer it does not know", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: "maybe" }));
    await expect(calls.changePassword("old", "new-password")).rejects.toMatchObject({
      kind: "malformed",
    });
  });

  it("fails a profile update the server refuses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    await expect(calls.updateAccount({ bio: "x" })).rejects.toMatchObject({ kind: "rate-limited" });
  });
});
