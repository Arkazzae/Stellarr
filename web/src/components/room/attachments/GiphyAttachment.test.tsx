import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGiphyGif, trackGiphyAction, type GiphyGif } from "@/lib/giphy";

import type { GiphyPart } from "../parts";

import { GiphyAttachment } from "./GiphyAttachment";

vi.mock("@/lib/giphy", () => ({
  resolveGiphyApiKey: vi.fn(async () => "key"),
  fetchGiphyGif: vi.fn(),
  trackGiphyAction: vi.fn(),
}));

const part: GiphyPart = { kind: "giphy", id: "abc123", pageUrl: "https://giphy.com/gifs/abc123" };

const gif: GiphyGif = {
  id: "abc123",
  pageUrl: "https://giphy.com/gifs/cat-abc123",
  title: "Cat",
  alt: "A dancing cat",
  username: "catlover",
  previewUrl: "https://media.giphy.com/preview.gif",
  mediaUrl: "https://media.giphy.com/media.gif",
  width: 320,
  height: 240,
  analytics: { onload: "https://giphy-analytics.giphy.com/view" },
};

beforeEach(() => {
  vi.mocked(fetchGiphyGif).mockReset();
  vi.mocked(trackGiphyAction).mockReset();
});

describe("GiphyAttachment", () => {
  it("shows a loading state, then the GIF with its attribution", async () => {
    vi.mocked(fetchGiphyGif).mockResolvedValue(gif);
    render(<GiphyAttachment part={part} customerId="customer" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "A dancing cat" })).toHaveAttribute(
      "src",
      gif.mediaUrl,
    );
    expect(screen.getByRole("link", { name: "@catlover w GIPHY" })).toHaveAttribute(
      "href",
      gif.pageUrl,
    );
  });

  it("falls back to a link to GIPHY when the GIF cannot be fetched", async () => {
    vi.mocked(fetchGiphyGif).mockRejectedValue(new Error("gone"));
    render(<GiphyAttachment part={part} customerId="customer" />);

    expect(await screen.findByText("GIF nie jest dostępny w podglądzie.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Otwórz w GIPHY" })).toHaveAttribute(
      "href",
      part.pageUrl,
    );
  });

  it("falls back the same way when the image itself fails to load", async () => {
    vi.mocked(fetchGiphyGif).mockResolvedValue(gif);
    render(<GiphyAttachment part={part} customerId="customer" />);

    fireEvent.error(await screen.findByRole("img", { name: "A dancing cat" }));
    expect(screen.getByRole("link", { name: "Otwórz w GIPHY" })).toBeInTheDocument();
  });

  it("reports a view to GIPHY once, however often the image fires load", async () => {
    vi.mocked(fetchGiphyGif).mockResolvedValue(gif);
    render(<GiphyAttachment part={part} customerId="customer" />);

    const image = await screen.findByRole("img", { name: "A dancing cat" });
    fireEvent.load(image);
    fireEvent.load(image);
    expect(trackGiphyAction).toHaveBeenCalledTimes(1);
    expect(trackGiphyAction).toHaveBeenCalledWith(gif.analytics.onload, "customer");
  });

  it("zooms the GIF through the lightbox callback when the host provides one", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    vi.mocked(fetchGiphyGif).mockResolvedValue(gif);
    render(<GiphyAttachment part={part} customerId="customer" onOpen={onOpen} />);

    await user.click(await screen.findByRole("button", { name: "Powiększ GIF: A dancing cat" }));
    expect(onOpen).toHaveBeenCalledWith([{ src: gif.mediaUrl, alt: gif.alt }], 0);
  });
});
