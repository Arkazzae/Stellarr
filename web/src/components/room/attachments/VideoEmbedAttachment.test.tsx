import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { VideoEmbedPart } from "../parts";
import { VideoEmbedAttachment } from "./VideoEmbedAttachment";

const youtube: VideoEmbedPart = {
  kind: "video-embed",
  provider: "youtube",
  providerId: "aqz-KE-bpKQ",
  url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  domain: "youtube.com",
  title: "Big Buck Bunny 60fps 4K",
  thumb: "/assets/provider-thumbnail",
};

describe("VideoEmbedAttachment", () => {
  it("shows the provider thumbnail, then plays inside the message", async () => {
    const user = userEvent.setup();
    const { container } = render(<VideoEmbedAttachment part={youtube} />);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/provider-thumbnail",
    );
    expect(container.querySelector("iframe")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Big Buck Bunny/i }));

    const frame = screen.getByTitle("Big Buck Bunny 60fps 4K");
    expect(frame).toHaveAttribute(
      "src",
      expect.stringContaining("youtube-nocookie.com/embed/aqz-KE-bpKQ"),
    );
    expect(frame).toHaveAttribute(
      "referrerpolicy",
      "strict-origin-when-cross-origin",
    );
  });

  it("never draws a fake poster when metadata has no thumbnail", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VideoEmbedAttachment part={{ ...youtube, thumb: undefined }} />,
    );

    expect(container.querySelector("img")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Odtwórz w YouTube" }),
    );
    expect(screen.getByTitle("Big Buck Bunny 60fps 4K")).toBeInTheDocument();
  });
});
