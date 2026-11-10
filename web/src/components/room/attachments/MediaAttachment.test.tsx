import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioAttachment } from "./AudioAttachment";
import { VideoAttachment } from "./VideoAttachment";

afterEach(() => vi.restoreAllMocks());

describe("uploaded media attachments", () => {
  it("controls the real audio resource instead of a timer", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = render(
      <AudioAttachment
        part={{ kind: "audio", name: "voice.wav", url: "/assets/audio" }}
      />,
    );

    const audio = container.querySelector("audio");
    expect(audio).toHaveAttribute("src", "/assets/audio");
    await user.click(screen.getByRole("button", { name: "Odtwórz voice.wav" }));
    expect(play).toHaveBeenCalledOnce();

    fireEvent.play(audio!);
    expect(screen.getByRole("button", { name: "Wstrzymaj voice.wav" })).toBeInTheDocument();
  });

  it("labels a composer recording as a voice message instead of exposing its generated file name", () => {
    render(
      <AudioAttachment
        part={{
          kind: "audio",
          name: "wiadomosc-glosowa-2026.webm",
          url: "/assets/voice",
          duration: "0:04",
          voiceMessage: true,
        }}
      />,
    );

    expect(screen.getByText("Wiadomość głosowa")).toBeInTheDocument();
    expect(screen.queryByText("wiadomosc-glosowa-2026.webm")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pobierz/ })).not.toBeInTheDocument();
  });

  it("clears playback failure when a refreshed attachment receives a new URL", () => {
    const { container, rerender } = render(
      <AudioAttachment
        part={{ kind: "audio", name: "voice.wav", url: "/assets/expired" }}
      />,
    );
    const audio = container.querySelector("audio")!;
    fireEvent.error(audio);
    expect(screen.getByRole("button", { name: "Nie można odtworzyć voice.wav" }))
      .toBeDisabled();

    rerender(
      <AudioAttachment
        part={{ kind: "audio", name: "voice.wav", url: "/assets/refreshed" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Odtwórz voice.wav" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      "/assets/refreshed",
    );
  });

  it("uses the uploaded video itself as the in-message preview", () => {
    const onPlay = vi.fn();
    const { container } = render(
      <VideoAttachment
        part={{ kind: "video", name: "clip.mp4", url: "/assets/video" }}
        onPlay={onPlay}
      />,
    );

    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", "/assets/video");
    fireEvent.click(screen.getByRole("button", { name: "Odtwórz wideo" }));
    expect(onPlay).toHaveBeenCalledOnce();
  });
});
