import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadTarget, plainText, startDownload } from "./messageExport";
import type { MessagePart } from "./parts";

const words = (text: string): MessagePart => ({ kind: "text", nodes: [{ kind: "text", text }] });
const nothingPointed = { part: null, media: null };

describe("plainText", () => {
  it("joins the text parts line by line and skips what has no words", () => {
    const parts: MessagePart[] = [
      words("pierwsza"),
      { kind: "image", src: "/a.png", alt: "a.png" },
      words(""),
      words("druga"),
    ];

    expect(plainText(parts)).toBe("pierwsza\ndruga");
  });

  it("writes emoji as codes, links as addresses and drops the edited mark", () => {
    const parts: MessagePart[] = [
      {
        kind: "text",
        nodes: [
          { kind: "text", text: "a " },
          { kind: "emoji", shortcode: "pepe", src: "/e.png" },
          { kind: "link", href: "https://example.com", text: "link" },
          { kind: "edited", at: "2026-08-13T10:00:00Z" },
        ],
      },
    ];

    expect(plainText(parts)).toBe("a :pepe:https://example.com");
  });

  it("keeps the characters of formatted runs", () => {
    const parts: MessagePart[] = [
      {
        kind: "text",
        nodes: [
          { kind: "strong", text: "mocne" },
          { kind: "code", text: "x" },
        ],
      },
    ];

    expect(plainText(parts)).toBe("mocnex");
  });
});

describe("downloadTarget", () => {
  const gallery: MessagePart = {
    kind: "gallery",
    images: [
      { src: "/one.png", alt: "one.png" },
      { src: "/two.png", alt: "two.png" },
    ],
  };

  it("picks the gallery tile under the pointer", () => {
    expect(downloadTarget([words("x"), gallery], { part: 1, media: 1 })).toEqual({
      href: "/two.png",
      name: "two.png",
      image: true,
    });
  });

  it("falls back to the first tile when the pointer index is past the end", () => {
    expect(downloadTarget([gallery], { part: 0, media: 9 })?.href).toBe("/one.png");
  });

  it("falls back to the first file of the message when the pointer was on words", () => {
    const target = downloadTarget(
      [words("x"), { kind: "file", name: "n.pdf", ext: "pdf", size: "1 MB", url: "/n.pdf" }],
      { part: 0, media: null },
    );

    expect(target).toEqual({ href: "/n.pdf", name: "n.pdf" });
  });

  it("skips parts that have no address", () => {
    const parts: MessagePart[] = [
      { kind: "image", src: "", alt: "gone.png" },
      { kind: "audio", name: "a.ogg" },
      { kind: "video", url: "/v.mp4" },
    ];

    expect(downloadTarget(parts, nothingPointed)).toEqual({ href: "/v.mp4", name: "" });
  });

  it("marks only pictures as images", () => {
    const audio: MessagePart = { kind: "audio", name: "a.ogg", url: "/a.ogg" };

    expect(downloadTarget([audio], nothingPointed)?.image).toBeUndefined();
  });

  it("finds nothing in a message of words", () => {
    expect(downloadTarget([words("x")], nothingPointed)).toBeUndefined();
  });
});

describe("startDownload", () => {
  afterEach(() => vi.restoreAllMocks());

  it("clicks a throwaway link that carries the name and leaves nothing behind", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    startDownload({ href: "/media/a.png", name: "a.png" });

    const link = click.mock.instances[0] as HTMLAnchorElement;
    expect(link).toHaveAttribute("href", "/media/a.png");
    expect(link).toHaveAttribute("download", "a.png");
    expect(link.isConnected).toBe(false);
  });
});
