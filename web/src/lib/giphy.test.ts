import { describe, expect, it, vi } from "vitest";

import {
  giphyIdFromUrl,
  parseGiphyGif,
  parseGiphyPage,
  resolveGiphyApiKey,
} from "./giphy";

const RAW_GIF = {
  id: "AbCd1234",
  url: "https://giphy.com/gifs/reaction-happy-AbCd1234",
  title: "Happy reaction GIF",
  alt_text: "A person celebrates.",
  username: "creator",
  images: {
    fixed_width: {
      url: "https://media.giphy.com/fixed.gif",
      webp: "https://media.giphy.com/fixed.webp",
      width: "200",
      height: "150",
    },
    fixed_width_still: {
      url: "https://media.giphy.com/still.gif",
      width: "200",
      height: "150",
    },
    downsized: {
      url: "https://media.giphy.com/downsized.gif",
      width: "480",
      height: "360",
    },
  },
  analytics: {
    onload: { url: "https://giphy-analytics.giphy.com/ping?event=seen" },
    onclick: { url: "https://giphy-analytics.giphy.com/ping?event=click" },
    onsent: { url: "https://giphy-analytics.giphy.com/ping?event=sent" },
  },
};

describe("GIPHY response parsing", () => {
  it("keeps the returned media URLs and accessible metadata", () => {
    expect(parseGiphyGif(RAW_GIF)).toMatchObject({
      id: "AbCd1234",
      pageUrl: "https://giphy.com/gifs/reaction-happy-AbCd1234",
      alt: "A person celebrates.",
      username: "creator",
      previewUrl: "https://media.giphy.com/fixed.webp",
      stillUrl: "https://media.giphy.com/still.gif",
      mediaUrl: "https://media.giphy.com/downsized.gif",
      width: 480,
      height: 360,
    });
  });

  it("drops action URLs that do not belong to GIPHY analytics", () => {
    const parsed = parseGiphyGif({
      ...RAW_GIF,
      analytics: { onclick: { url: "https://evil.example/track" } },
    });
    expect(parsed?.analytics.onclick).toBeUndefined();
  });

  it("parses pagination while dropping malformed GIF entries", () => {
    expect(
      parseGiphyPage({
        data: [RAW_GIF, { id: "broken" }],
        pagination: { offset: 24, count: 2, total_count: 80 },
      }),
    ).toMatchObject({ offset: 24, count: 2, totalCount: 80, items: [{ id: "AbCd1234" }] });
  });
});

describe("giphyIdFromUrl", () => {
  it("reads ids from canonical page URLs", () => {
    expect(giphyIdFromUrl("https://giphy.com/gifs/reaction-happy-AbCd1234")).toBe("AbCd1234");
    expect(giphyIdFromUrl("https://www.giphy.com/gifs/AbCd1234")).toBe("AbCd1234");
  });

  it("refuses lookalike hosts, media URLs and non-HTTPS links", () => {
    expect(giphyIdFromUrl("https://giphy.com.evil.example/gifs/AbCd1234")).toBeNull();
    expect(giphyIdFromUrl("https://media.giphy.com/media/AbCd1234/giphy.gif")).toBeNull();
    expect(giphyIdFromUrl("http://giphy.com/gifs/AbCd1234")).toBeNull();
  });
});

describe("GIPHY runtime configuration", () => {
  it("loads a deployment-time key when no key was bundled", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ apiKey: " runtime-key " }),
    } as Response);

    await expect(resolveGiphyApiKey("")).resolves.toBe("runtime-key");
    expect(request).toHaveBeenCalledWith("/api/config/giphy", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  });
});
