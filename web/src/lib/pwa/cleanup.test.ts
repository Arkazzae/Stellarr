import { afterEach, describe, expect, it, vi } from "vitest";

import { removeLegacyPwaArtifacts } from "./cleanup";

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
const originalCaches = Object.getOwnPropertyDescriptor(window, "caches");

afterEach(() => {
  if (originalServiceWorker === undefined) Reflect.deleteProperty(navigator, "serviceWorker");
  else Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  if (originalCaches === undefined) Reflect.deleteProperty(window, "caches");
  else Object.defineProperty(window, "caches", originalCaches);
});

describe("legacy PWA cleanup", () => {
  it("unregisters workers and removes persistent web caches", async () => {
    const unregister = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { getRegistrations: vi.fn(async () => [{ unregister }]) },
      configurable: true,
    });
    Object.defineProperty(window, "caches", {
      value: { keys: vi.fn(async () => ["old-shell"]), delete: deleteCache },
      configurable: true,
    });

    await removeLegacyPwaArtifacts();

    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("old-shell");
  });
});
