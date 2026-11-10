import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShareBand } from "./ShareBand";

describe("ShareBand", () => {
  it("plays the local screen stream as a muted preview", () => {
    const stream = {} as MediaStream;
    render(
      <ShareBand
        local
        share={{
          ownerId: "maja",
          ownerName: "Maja",
          hasAudio: true,
          stream,
          watching: true,
        }}
        onWatch={vi.fn()}
        onStopWatching={vi.fn()}
      />,
    );

    const video = screen.getByLabelText("Udostępniany ekran — Maja");
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(video).toHaveProperty("srcObject", stream);
    expect(video).toHaveProperty("muted", true);
    expect(screen.queryByRole("button", { name: "Przestań oglądać" })).toBeNull();
  });

  it("shows a placeholder instead of a broken image without a stream or poster", () => {
    const { container } = render(
      <ShareBand
        share={{
          ownerId: "maja",
          ownerName: "Maja",
          hasAudio: false,
          stream: null,
          watching: false,
        }}
        onWatch={vi.fn()}
        onStopWatching={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "Podgląd udostępniania jest niedostępny",
      }),
    ).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Oglądaj" })).toBeVisible();
    // The note is written once, under the title, not behind the button.
    expect(screen.getAllByText("Podgląd udostępniania jest niedostępny")).toHaveLength(1);
    expect(container.querySelector(".watch-cover .wc-note")).not.toBeNull();
  });

  it("replaces the sharing pill with an in-stream volume control", () => {
    const onVolumeChange = vi.fn();
    const { container } = render(
      <ShareBand
        share={{
          ownerId: "maja",
          ownerName: "Maja",
          hasAudio: true,
          stream: {} as MediaStream,
          watching: true,
        }}
        volume={125}
        onVolumeChange={onVolumeChange}
        onWatch={vi.fn()}
        onStopWatching={vi.fn()}
      />,
    );

    expect(container.querySelector(".share-label")).not.toBeInTheDocument();
    expect(screen.queryByText("Maja udostępnia ekran")).not.toBeInTheDocument();
    const volume = screen.getByRole("slider", { name: "Głośność: Maja" });
    expect(volume).toHaveValue("125");
    fireEvent.change(volume, { target: { value: "70" } });
    expect(onVolumeChange).toHaveBeenCalledWith(70);
  });
});
