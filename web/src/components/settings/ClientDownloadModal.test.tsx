import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClientDownloadModal } from "./ClientDownloadModal";

describe("ClientDownloadModal", () => {
  it("offers the published Android and Arch clients next to the active browser", async () => {
    render(
      <ClientDownloadModal
        open
        onClose={vi.fn()}
        loadReleases={vi.fn(async () => [
          {
            version: "0.1.0",
            publishedAt: "2026-09-02T12:00:00Z",
            notes: "Android",
            platform: "android" as const,
            architecture: "arm64-v8a" as const,
            fileName: "stellarr-android-0.1.0-arm64-v8a.apk",
            sizeBytes: 82_000_000,
            sha256: "a".repeat(64),
            downloadUrl: "/api/android/release/apk",
          },
          {
            version: "0.1.3",
            publishedAt: "2026-09-02T12:00:00Z",
            notes: "Arch",
            platform: "arch" as const,
            architecture: "x86_64" as const,
            fileName: "stellarr-desktop-0.1.3-1-x86_64.pkg.tar.zst",
            sizeBytes: 120_000_000,
            sha256: "b".repeat(64),
            downloadUrl: "/api/desktop/release/arch",
          },
        ])}
      />,
    );

    expect(await screen.findByText("Android")).toBeVisible();
    expect(screen.getByText("Arch Linux")).toBeVisible();
    expect(screen.getByText("Przeglądarka")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Pobierz" })).toEqual([
      expect.objectContaining({ href: expect.stringContaining("/api/android/release/apk") }),
      expect.objectContaining({ href: expect.stringContaining("/api/desktop/release/arch") }),
    ]);
    expect(screen.getByText("a".repeat(64))).toHaveAttribute("title", "a".repeat(64));
  });

  it("shows an empty state while keeping the browser client visible", async () => {
    render(
      <ClientDownloadModal
        open
        onClose={vi.fn()}
        loadReleases={vi.fn(async () => [])}
      />,
    );

    expect(await screen.findByText(/nie opublikował jeszcze aplikacji/i)).toBeVisible();
    expect(screen.getByText("Przeglądarka")).toBeVisible();
  });
});
