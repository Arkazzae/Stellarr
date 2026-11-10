import { describe, expect, it, vi } from "vitest";

import { fakeApi, SELF } from "@/test/fakes";

import { createAccountAdapter } from "./account";

describe("account adapter", () => {
  it("hydrates and persists profile and preference changes through the API", async () => {
    const api = fakeApi();
    const adapter = createAccountAdapter(api);
    const changed = vi.fn();
    adapter.onChanged(changed);

    await adapter.hydrate(SELF);
    expect(adapter.getAccount()).toMatchObject({ id: SELF.id, displayName: "Maja" });
    expect(adapter.supported).toEqual({
      profile: true,
      uploads: true,
      password: true,
      preferences: true,
    });

    await adapter.update({
      displayName: "Maja K.",
      customStatus: "🎧 na słuchawkach",
    });
    expect(api.updateAccount).toHaveBeenCalledWith({
      displayName: "Maja K.",
      customStatus: "🎧 na słuchawkach",
    });
    expect(adapter.getAccount().customStatus).toBe("🎧 na słuchawkach");

    await adapter.setPreferences({
      reducedMotion: true,
      mutedChannelIds: ["channel-quiet"],
    });
    expect(api.updatePreferences).toHaveBeenCalledWith({
      reducedMotion: true,
      mutedChannelIds: ["channel-quiet"],
    });
    expect(adapter.getPreferences().reducedMotion).toBe(true);
    expect(adapter.getPreferences().mutedChannelIds).toEqual(["channel-quiet"]);
    expect(changed).toHaveBeenCalled();
  });

  it("commits image uploads and removes them through dedicated endpoints", async () => {
    const api = fakeApi();
    const adapter = createAccountAdapter(api);
    await adapter.hydrate(SELF);

    const image = new File(["image"], "avatar.png", { type: "image/png" });
    await expect(adapter.uploadImage("avatar", image)).resolves.toBe(
      "/assets/avatar",
    );
    expect(adapter.getAccount().avatarUrl).toBe("/assets/avatar");

    await adapter.update({ avatarUrl: null });
    expect(api.removeAccountImage).toHaveBeenCalledWith("avatar");
  });
});
