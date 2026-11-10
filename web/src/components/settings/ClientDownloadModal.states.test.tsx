import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ClientRelease } from "@/lib/desktopRelease";

import { ClientDownloadModal } from "./ClientDownloadModal";

const ARCH: ClientRelease = {
  version: "0.1.3",
  publishedAt: "2026-09-02T12:00:00Z",
  notes: "Arch",
  platform: "arch",
  architecture: "x86_64",
  fileName: "stellarr-desktop-0.1.3-1-x86_64.pkg.tar.zst",
  sizeBytes: 120_000_000,
  sha256: "b".repeat(64),
  downloadUrl: "/api/desktop/release/arch",
};

describe("ClientDownloadModal states", () => {
  it("says it is checking while the releases are on their way", () => {
    render(<ClientDownloadModal open onClose={vi.fn()} loadReleases={() => new Promise(() => {})} />);

    expect(screen.getByRole("status")).toHaveTextContent("Sprawdzanie najnowszego wydania…");
    expect(screen.getByText("Przeglądarka")).toBeVisible();
  });

  it("reports a failed lookup and keeps the browser client listed", async () => {
    render(
      <ClientDownloadModal
        open
        onClose={vi.fn()}
        loadReleases={vi.fn().mockRejectedValue(new Error("offline"))}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się sprawdzić wydania.");
    expect(screen.getByText("Przeglądarka")).toBeVisible();
  });

  it("does not treat its own abort as a failure", async () => {
    let signal: AbortSignal | undefined;
    const loadReleases = vi.fn(
      (given?: AbortSignal) =>
        new Promise<ClientRelease[]>((_resolve, reject) => {
          signal = given;
          given?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const { rerender } = render(<ClientDownloadModal open onClose={vi.fn()} loadReleases={loadReleases} />);
    rerender(<ClientDownloadModal open={false} onClose={vi.fn()} loadReleases={loadReleases} />);

    expect(signal?.aborted).toBe(true);
    // The rejection lands a microtask later, while the closing dialog is still mounted.
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers the install note only when an Android build is published", async () => {
    const { rerender } = render(
      <ClientDownloadModal open onClose={vi.fn()} loadReleases={vi.fn(async () => [ARCH])} />,
    );

    expect(await screen.findByText("Arch Linux")).toBeVisible();
    expect(screen.queryByText(/otwórz APK na telefonie/)).toBeNull();

    const android: ClientRelease = { ...ARCH, platform: "android", architecture: "arm64-v8a" };
    rerender(
      <ClientDownloadModal open onClose={vi.fn()} loadReleases={vi.fn(async () => [android])} />,
    );
    expect(await screen.findByText(/otwórz APK na telefonie/)).toBeVisible();
  });

  it("names the download after the published file", async () => {
    render(<ClientDownloadModal open onClose={vi.fn()} loadReleases={vi.fn(async () => [ARCH])} />);

    expect(await screen.findByRole("link", { name: "Pobierz" })).toHaveAttribute(
      "download",
      "stellarr-desktop-0.1.3-1-x86_64.pkg.tar.zst",
    );
  });
});
