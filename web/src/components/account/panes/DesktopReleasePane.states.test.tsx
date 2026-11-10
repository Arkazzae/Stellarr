import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DesktopRelease } from "@/lib/desktopRelease";

import { DesktopReleasePane } from "./DesktopReleasePane";

const release: DesktopRelease = {
  version: "0.2.0",
  publishedAt: "2026-10-01T12:00:00Z",
  notes: "Notes",
  platform: "arch",
  architecture: "x86_64",
  fileName: "stellarr-desktop-0.2.0-1-x86_64.pkg.tar.zst",
  sizeBytes: 2 * 1024 * 1024,
  sha256: "b".repeat(64),
  downloadUrl: "/api/desktop/release/arch",
};

describe("DesktopReleasePane states", () => {
  it("shows that the lookup is running before it answers", async () => {
    let finish: (value: DesktopRelease | null) => void = () => undefined;
    const loadRelease = vi.fn(
      () => new Promise<DesktopRelease | null>((resolve) => { finish = resolve; }),
    );
    render(<DesktopReleasePane loadRelease={loadRelease} />);

    expect(screen.getByRole("status")).toHaveTextContent("Sprawdzanie najnowszego wydania");

    finish(release);
    expect(await screen.findByText("Wersja 0.2.0")).toBeVisible();
  });

  it("reports a failed lookup", async () => {
    render(<DesktopReleasePane loadRelease={vi.fn(async () => { throw new Error("down"); })} />);

    expect(await screen.findByRole("alert")).toBeVisible();
  });

  it("names the package in the install hint and formats its size", async () => {
    render(<DesktopReleasePane loadRelease={vi.fn(async () => release)} />);

    expect(await screen.findByText(/stellarr-desktop-0\.2\.0-1-x86_64\.pkg\.tar\.zst/)).toBeVisible();
    expect(screen.getByText(/2\.0 MB/)).toBeVisible();
  });

  it("aborts the lookup when the pane goes away and ignores its late answer", async () => {
    let signal: AbortSignal | undefined;
    let finish: (value: DesktopRelease | null) => void = () => undefined;
    const loadRelease = vi.fn((given?: AbortSignal) => {
      signal = given;
      return new Promise<DesktopRelease | null>((resolve) => { finish = resolve; });
    });
    const { unmount } = render(<DesktopReleasePane loadRelease={loadRelease} />);

    unmount();
    expect(signal?.aborted).toBe(true);
    finish(release);
    await waitFor(() => expect(loadRelease).toHaveBeenCalledOnce());
  });
});
