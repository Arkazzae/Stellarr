import { describe, expect, it, vi } from "vitest";

import { fakeApi, SELF } from "@/test/fakes";

import { createAccountAdapter } from "./account";

describe("account adapter edge cases", () => {
  it("starts with default preferences before it has been hydrated", () => {
    const adapter = createAccountAdapter(fakeApi());

    expect(adapter.getAccount().id).toBe("");
    expect(adapter.getPreferences()).toMatchObject({
      mentionsOnly: true,
      developerMode: false,
      joinSoundId: null,
    });
  });

  it("refuses an account payload that belongs to another user", async () => {
    const api = fakeApi();
    const adapter = createAccountAdapter(api);
    const changed = vi.fn();
    adapter.onChanged(changed);

    await expect(adapter.hydrate({ ...SELF, id: "u-someone-else" })).rejects.toThrow(
      "does not belong to the active session",
    );
    expect(adapter.getAccount().id).toBe("");
    expect(changed).not.toHaveBeenCalled();
  });

  it("sends an empty id when the arrival sound is cleared", async () => {
    const api = fakeApi();
    const adapter = createAccountAdapter(api);

    await adapter.setPreferences({ joinSoundId: null });
    expect(api.updatePreferences).toHaveBeenCalledWith({ joinSoundId: "" });

    await adapter.setPreferences({ joinSoundId: "sound-7" });
    expect(api.updatePreferences).toHaveBeenLastCalledWith({ joinSoundId: "sound-7" });
  });

  it("does not call the profile endpoint for an image-only or empty patch", async () => {
    const api = fakeApi();
    const adapter = createAccountAdapter(api);
    await adapter.hydrate(SELF);

    await adapter.update({});
    await adapter.update({ bannerUrl: null });

    expect(api.updateAccount).not.toHaveBeenCalled();
    expect(api.removeAccountImage).toHaveBeenCalledTimes(1);
    expect(api.removeAccountImage).toHaveBeenCalledWith("banner");
  });

  it("never writes a client-supplied picture URL back to the account", async () => {
    const api = fakeApi();
    const adapter = createAccountAdapter(api);
    await adapter.hydrate(SELF);

    await adapter.update({ avatarUrl: "https://elsewhere.example/a.png" });

    expect(api.updateAccount).not.toHaveBeenCalled();
    expect(adapter.getAccount().avatarUrl).toBeUndefined();
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    const adapter = createAccountAdapter(fakeApi());
    const changed = vi.fn();
    const unsubscribe = adapter.onChanged(changed);

    await adapter.setPreferences({ reducedMotion: true });
    unsubscribe();
    await adapter.setPreferences({ reducedMotion: false });

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("passes the password answer through without throwing", async () => {
    const api = fakeApi({ changePassword: vi.fn(async () => "wrong-current" as const) });
    const adapter = createAccountAdapter(api);

    await expect(adapter.changePassword("old", "new-password")).resolves.toBe(
      "wrong-current",
    );
    expect(api.changePassword).toHaveBeenCalledWith("old", "new-password");
  });

  it("reads the arrival sound library on demand", async () => {
    const api = fakeApi();
    const adapter = createAccountAdapter(api);
    const signal = new AbortController().signal;

    await expect(adapter.listJoinSounds(signal)).resolves.toMatchObject({ maxSeconds: 5 });
    expect(api.getJoinSoundLibrary).toHaveBeenCalledWith(signal);
  });
});
