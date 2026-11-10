import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getClientReleases,
  getDesktopRelease,
  type ClientRelease,
  type DesktopRelease,
} from "./desktopRelease";

const desktop: DesktopRelease = {
  version: "1.4.0",
  publishedAt: "2026-05-01T10:00:00Z",
  notes: "Fixes",
  platform: "arch",
  architecture: "x86_64",
  fileName: "stellarr-1.4.0-x86_64.pkg.tar.zst",
  sizeBytes: 1234,
  sha256: "abc",
  downloadUrl: "/assets/client/stellarr.pkg.tar.zst",
};

function respondWith(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getClientReleases", () => {
  it("lists the published clients with the session cookie and a JSON accept header", async () => {
    const android: ClientRelease = {
      ...desktop,
      platform: "android",
      architecture: "arm64-v8a",
    };
    const fetchMock = respondWith([desktop, android]);
    const controller = new AbortController();

    await expect(getClientReleases(controller.signal)).resolves.toEqual([desktop, android]);

    expect(fetchMock).toHaveBeenCalledWith("/api/client/releases", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  });

  it("reports the status of a failed request", async () => {
    respondWith({}, 503);

    await expect(getClientReleases()).rejects.toThrow(
      "Client releases request failed with 503.",
    );
  });
});

describe("getDesktopRelease", () => {
  it("returns the published desktop build", async () => {
    const fetchMock = respondWith(desktop);

    await expect(getDesktopRelease()).resolves.toEqual(desktop);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/desktop/release",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("returns null when no build is published", async () => {
    respondWith({}, 404);

    await expect(getDesktopRelease()).resolves.toBeNull();
  });

  it("reports the status of any other failure", async () => {
    respondWith({}, 500);

    await expect(getDesktopRelease()).rejects.toThrow(
      "Desktop release request failed with 500.",
    );
  });
});
