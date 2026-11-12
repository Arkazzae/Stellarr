import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type Translator } from "@/i18n";
import { fetchGiphyGif } from "@/lib/giphy";

import { parseInline, tokenizeCode, type MessagePart } from "../parts";

import { Attachment } from "./Attachment";

// A GIF that never resolves keeps the tile in its loading state.
vi.mock("@/lib/giphy", () => ({
  resolveGiphyApiKey: vi.fn(async () => "key"),
  fetchGiphyGif: vi.fn(() => new Promise(() => undefined)),
  trackGiphyAction: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

const image: MessagePart = { kind: "image", src: "/assets/cat", alt: "A cat" };
const gallery: MessagePart = {
  kind: "gallery",
  images: [
    { src: "/assets/one", alt: "First" },
    { src: "/assets/two", alt: "Second" },
  ],
};
const file: MessagePart = { kind: "file", name: "report.pdf", ext: "PDF", size: "2 KB" };
const audio: MessagePart = { kind: "audio", name: "voice.wav", url: "/assets/audio" };
const video: MessagePart = { kind: "video", name: "clip.mp4", url: "/assets/video" };
const embed: MessagePart = {
  kind: "embed",
  domain: "example.org",
  title: "A page",
  description: "",
};
const videoEmbed: MessagePart = {
  kind: "video-embed",
  provider: "youtube",
  providerId: "aqz-KE-bpKQ",
  url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  domain: "youtube.com",
  title: "A clip",
  thumb: "/assets/thumb",
};
const giphy: MessagePart = {
  kind: "giphy",
  id: "abc123",
  pageUrl: "https://giphy.com/gifs/abc123",
};
const code: MessagePart = {
  kind: "code",
  lang: "ts",
  source: "const x = 1",
  language: "typescript",
  tokens: tokenizeCode("const x = 1", "typescript"),
};
const text: MessagePart = { kind: "text", nodes: parseInline("Hello there") };

describe("Attachment", () => {
  it.each([
    ["text", text, () => screen.getByText("Hello there")],
    ["image", image, () => screen.getByRole("img", { name: "A cat" })],
    ["gallery", gallery, () => screen.getAllByRole("img", { name: /First|Second/ })],
    ["file", file, () => screen.getByRole("group", { name: "Załącznik report.pdf" })],
    ["audio", audio, () => screen.getByRole("slider")],
    ["video", video, () => screen.getByLabelText("Odtwórz wideo")],
    ["embed", embed, () => screen.getByRole("link", { name: "A page (example.org)" })],
    ["video-embed", videoEmbed, () => screen.getByRole("button", { name: /A clip/ })],
    ["giphy", giphy, () => screen.getByRole("status")],
    ["code", code, () => screen.getByRole("combobox", { name: "Język podświetlania" })],
  ] as const)("renders a %s part with its own renderer", (_kind, part, find) => {
    render(<Attachment part={part} />);
    expect(find()).toBeTruthy();
  });

  it("opens an image, and every image of a gallery, through the lightbox callback", async () => {
    const user = userEvent.setup();
    const onOpenImage = vi.fn();
    const { rerender } = render(<Attachment part={image} callbacks={{ onOpenImage }} />);

    await user.click(screen.getByRole("img", { name: "A cat" }));
    expect(onOpenImage).toHaveBeenLastCalledWith([{ src: "/assets/cat", alt: "A cat" }], 0);

    rerender(<Attachment part={gallery} callbacks={{ onOpenImage }} />);
    await user.click(screen.getByRole("img", { name: "Second" }));
    expect(onOpenImage).toHaveBeenLastCalledWith(
      [
        { src: "/assets/one", alt: "First" },
        { src: "/assets/two", alt: "Second" },
      ],
      1,
    );
  });

  it("hands a file, a video and an embed back to the host that asked to be told", async () => {
    const user = userEvent.setup();
    const onDownloadFile = vi.fn();
    const onPlayVideo = vi.fn();
    const onOpenEmbed = vi.fn();
    const callbacks = { onDownloadFile, onPlayVideo, onOpenEmbed };
    const { rerender } = render(<Attachment part={file} callbacks={callbacks} />);

    await user.click(screen.getByRole("button", { name: "Pobierz report.pdf" }));
    expect(onDownloadFile).toHaveBeenCalledWith(file);

    rerender(<Attachment part={video} callbacks={callbacks} />);
    await user.click(screen.getByRole("button", { name: "Odtwórz wideo" }));
    expect(onPlayVideo).toHaveBeenCalledWith(video);

    rerender(<Attachment part={embed} callbacks={callbacks} />);
    const card = screen.getByRole("link", { name: "A page (example.org)" });
    await user.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpenEmbed).toHaveBeenCalledTimes(2);
    expect(onOpenEmbed).toHaveBeenCalledWith(embed);
  });

  it("copies code through the host when it provides a handler", async () => {
    const user = userEvent.setup();
    const onCopyCode = vi.fn();
    render(<Attachment part={code} callbacks={{ onCopyCode }} />);

    await user.click(screen.getByRole("button", { name: "Kopiuj kod" }));
    expect(onCopyCode).toHaveBeenCalledWith(expect.objectContaining({ source: "const x = 1" }));
  });

  it("asks GIPHY on behalf of the host's customer id, or Stellarr's own", async () => {
    const { rerender } = render(<Attachment part={giphy} />);
    await vi.waitFor(() => expect(fetchGiphyGif).toHaveBeenCalledTimes(1));
    expect(fetchGiphyGif).toHaveBeenLastCalledWith("key", "abc123", "stellarr", expect.anything());

    rerender(<Attachment part={giphy} callbacks={{ giphyCustomerId: "customer-7" }} />);
    await vi.waitFor(() => expect(fetchGiphyGif).toHaveBeenCalledTimes(2));
    expect(fetchGiphyGif).toHaveBeenLastCalledWith("key", "abc123", "customer-7", expect.anything());
  });

  it("offers translation of a text part only when the host enables it", () => {
    const translation = {
      locale: "pl" as const,
      enabled: true,
      autoTranslate: false,
      targetLanguage: "en" as const,
      t: ((key, values) => translateMessage("pl", key, values)) satisfies Translator,
    };
    const { rerender } = render(<Attachment part={text} translation={translation} />);
    expect(screen.getByRole("button", { name: "Przetłumacz" })).toBeInTheDocument();

    rerender(<Attachment part={text} translation={{ ...translation, enabled: false }} />);
    expect(screen.queryByRole("button", { name: "Przetłumacz" })).toBeNull();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });
});
