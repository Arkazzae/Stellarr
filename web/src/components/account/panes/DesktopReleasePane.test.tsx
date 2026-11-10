import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DesktopReleasePane } from "./DesktopReleasePane";

describe("DesktopReleasePane", () => {
  it("shows the published Arch package, checksum and download", async () => {
    render(
      <DesktopReleasePane
        loadRelease={vi.fn(async () => ({
          version: "0.1.1",
          publishedAt: "2026-09-01T12:00:00Z",
          notes: "Pierwsze wydanie dla Arch Linux",
          platform: "arch" as const,
          architecture: "x86_64" as const,
          fileName: "stellarr-desktop-0.1.1-1-x86_64.pkg.tar.zst",
          sizeBytes: 143_433_301,
          sha256: "a".repeat(64),
          downloadUrl: "/api/desktop/release/arch",
        }))}
      />,
    );

    expect(await screen.findByText("Wersja 0.1.1")).toBeVisible();
    expect(screen.getByText("Pierwsze wydanie dla Arch Linux")).toBeVisible();
    expect(screen.getByText("a".repeat(64))).toHaveAttribute("title", "a".repeat(64));
    expect(screen.getByRole("link", { name: "Pobierz paczkę" })).toHaveAttribute(
      "href",
      "/api/desktop/release/arch",
    );
  });

  it("explains when no package has been published", async () => {
    render(<DesktopReleasePane loadRelease={vi.fn(async () => null)} />);
    expect(await screen.findByText(/nie opublikował jeszcze paczki/i)).toBeVisible();
  });
});
