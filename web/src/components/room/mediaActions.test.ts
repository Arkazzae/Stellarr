import { afterEach, describe, expect, it, vi } from "vitest";

import { absoluteUrl, copyImage, fileNameFor, saveFile } from "./mediaActions";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function imageResponse(type: string): Response {
  return new Response("pixels", { headers: { "Content-Type": type } });
}

describe("absoluteUrl", () => {
  it("resolves a relative address against the page", () => {
    expect(absoluteUrl("/files/kot.png")).toBe(
      new URL("/files/kot.png", window.location.href).toString(),
    );
  });

  it("leaves an absolute address as it is", () => {
    expect(absoluteUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
  });
});

describe("fileNameFor", () => {
  it("prefers the given name, trimmed", () => {
    expect(fileNameFor("/files/x.png", "  kot.png ")).toBe("kot.png");
  });

  it("falls back to the decoded last segment of the address", () => {
    expect(fileNameFor("/files/kot%20duzy.png?size=2")).toBe("kot duzy.png");
    expect(fileNameFor("/files/x.png", "   ")).toBe("x.png");
  });

  it("reads the last path segment of a blob: or data: address as well", () => {
    expect(fileNameFor("blob:https://stellarr.example/1b2c-3d4e")).toBe("1b2c-3d4e");
    expect(fileNameFor("data:image/png;base64,AAAA")).toBe("png;base64,AAAA");
  });

  it("uses the fallback when the address names no file", () => {
    expect(fileNameFor("/")).toBe("obraz.png");
    expect(fileNameFor("https://stellarr.example/", undefined, "nagranie.mp4")).toBe(
      "nagranie.mp4",
    );
    expect(fileNameFor("/files/%E0%A4%A", undefined, "plik.bin")).toBe("plik.bin");
  });
});

describe("saveFile", () => {
  function captureDownloads() {
    const saved: { href: string; download: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({
        href: this.getAttribute("href") ?? "",
        download: this.download,
        attached: this.isConnected,
      });
    });
    return saved;
  }

  it("downloads through a blob and releases it a minute later", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse("image/png")));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:saved");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const saved = captureDownloads();

    await saveFile("/files/kot.png", "kot.png");

    expect(saved).toEqual([{ href: "blob:saved", download: "kot.png", attached: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:saved");
  });

  it("links straight to a source it cannot read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("blocked"))));
    const create = vi.spyOn(URL, "createObjectURL");
    const saved = captureDownloads();

    await saveFile("https://cdn.example/clip.mp4", "clip.mp4");

    expect(create).not.toHaveBeenCalled();
    expect(saved).toEqual([
      { href: "https://cdn.example/clip.mp4", download: "clip.mp4", attached: true },
    ]);
  });
});

describe("copyImage", () => {
  class FakeClipboardItem {
    constructor(readonly items: Record<string, Blob>) {}
  }

  function stubClipboard() {
    const write = vi.fn(async (_items: FakeClipboardItem[]) => undefined);
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { write } });
    return write;
  }

  it("puts a PNG on the clipboard as it is", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse("image/png")));
    const write = stubClipboard();

    await copyImage("/files/kot.png");

    const [items] = write.mock.calls[0]!;
    expect(items).toHaveLength(1);
    expect(items![0]!.items["image/png"]!.type).toBe("image/png");
  });

  it("redraws other formats as PNG before copying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse("image/webp")),
    );
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4, height: 3, close })));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) =>
      callback(new Blob(["png"], { type })),
    );
    const write = stubClipboard();

    await copyImage("/files/kot.webp");

    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]![0]!.items["image/png"]!.type).toBe("image/png");
  });

  it("rejects when the image cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const write = stubClipboard();

    await expect(copyImage("/files/gone.png")).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
