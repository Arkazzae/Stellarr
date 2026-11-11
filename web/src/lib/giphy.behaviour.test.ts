import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageKey } from "@/i18n";

import {
  fetchGiphyGif,
  fetchGiphyPage,
  giphyIdFromUrl,
  parseGiphyGif,
  parseGiphyPage,
  trackGiphyAction,
} from "./giphy";

const fetchMock = vi.fn();

/** What a failed call throws: an error naming the catalog entry that words it. */
function failure(messageKey: MessageKey) {
  return expect.objectContaining({ messageKey });
}

function respond(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

function rendition(url: string, extra: Record<string, unknown> = {}) {
  return { url, width: "100", height: "80", ...extra };
}

function gif(images: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: "AbCd1234", images, ...extra };
}

/** The one request the mock received, as a URL plus its init. */
function lastRequest(): { url: URL; init: RequestInit } {
  const [target, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit];
  return { url: new URL(target), init };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the runtime API key", () => {
  // The pending request lives in the module, so each test starts it afresh.
  async function loadResolver() {
    vi.resetModules();
    return (await import("./giphy")).resolveGiphyApiKey;
  }

  it("lets the server turn GIFs off even when a key was bundled", async () => {
    const resolveGiphyApiKey = await loadResolver();
    fetchMock.mockResolvedValue(respond({ enabled: false, apiKey: "" }));

    await expect(resolveGiphyApiKey("  bundled  ")).rejects.toThrow(failure("giphy.keyMissing"));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses a bundled key only while the server cannot be asked", async () => {
    const resolveGiphyApiKey = await loadResolver();
    fetchMock.mockResolvedValue(respond({}, { ok: false, status: 503 }));

    await expect(resolveGiphyApiKey("  bundled  ")).resolves.toBe("bundled");
  });

  it("hands out no key when the server says GIFs are off, whatever key it sends", async () => {
    const resolveGiphyApiKey = await loadResolver();
    fetchMock.mockResolvedValue(respond({ enabled: false, apiKey: "leftover" }));

    await expect(resolveGiphyApiKey("")).rejects.toThrow(failure("giphy.keyMissing"));
  });

  it("uses the server's key when GIFs are on", async () => {
    const resolveGiphyApiKey = await loadResolver();
    fetchMock.mockResolvedValue(respond({ enabled: true, apiKey: " panel-key " }));

    await expect(resolveGiphyApiKey("bundled")).resolves.toBe("panel-key");
  });

  it("asks the server once for callers that overlap or come later", async () => {
    const resolveGiphyApiKey = await loadResolver();
    fetchMock.mockResolvedValue(respond({ apiKey: "from-server" }));

    const keys = await Promise.all([resolveGiphyApiKey(""), resolveGiphyApiKey(" ")]);
    keys.push(await resolveGiphyApiKey(""));

    expect(keys).toEqual(["from-server", "from-server", "from-server"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("asks again after a failure instead of remembering it", async () => {
    const resolveGiphyApiKey = await loadResolver();
    fetchMock.mockResolvedValueOnce(respond({}, { ok: false, status: 503 }));
    fetchMock.mockResolvedValueOnce(respond({ apiKey: "second-try" }));

    await expect(resolveGiphyApiKey("")).rejects.toThrow(failure("giphy.configUnreadable"));
    await expect(resolveGiphyApiKey("")).resolves.toBe("second-try");
  });

  it("fails when the server has no key configured", async () => {
    const resolveGiphyApiKey = await loadResolver();
    fetchMock.mockResolvedValue(respond({ apiKey: "   " }));

    await expect(resolveGiphyApiKey("")).rejects.toThrow(failure("giphy.keyMissing"));
  });
});

describe("parsing a GIF", () => {
  it("falls back through the renditions and clamps sizes to at least one pixel", () => {
    const parsed = parseGiphyGif(
      gif({
        fixed_width: rendition("https://media.giphy.com/fixed.gif"),
        downsized_medium: { url: "https://media.giphy.com/medium.gif", width: 0, height: "x" },
        downsized_still: rendition("https://media.giphy.com/downsized-still.gif"),
      }),
    );

    expect(parsed).toMatchObject({
      previewUrl: "https://media.giphy.com/fixed.gif",
      stillUrl: "https://media.giphy.com/downsized-still.gif",
      mediaUrl: "https://media.giphy.com/medium.gif",
      width: 1,
      height: 1,
    });
  });

  it("skips a rendition that is not served over https", () => {
    const parsed = parseGiphyGif(
      gif({
        fixed_width: rendition("http://media.giphy.com/fixed.gif"),
        downsized: rendition("https://media.giphy.com/downsized.gif"),
      }),
    );

    expect(parsed?.previewUrl).toBe("https://media.giphy.com/downsized.gif");
    expect(parsed).not.toHaveProperty("stillUrl");
  });

  it.each([
    ["an id with characters outside letters and digits", gif({}, { id: "a/b" })],
    ["no usable preview", gif({ original: rendition("https://media.giphy.com/o.gif") })],
    ["no usable media", gif({ fixed_width: rendition("https://media.giphy.com/f.gif") })],
    ["no images", { id: "AbCd1234" }],
  ])("rejects an item with %s", (_label, item) => {
    expect(parseGiphyGif(item)).toBeNull();
  });

  it("names an untitled GIF and takes the author from the user object", () => {
    const parsed = parseGiphyGif(
      gif(
        { downsized: rendition("https://media.giphy.com/d.gif") },
        { user: { username: "from-user" }, url: "https://evil.example/gifs/AbCd1234" },
      ),
    );

    expect(parsed).toMatchObject({
      title: "GIF z GIPHY",
      alt: "GIF z GIPHY",
      username: "from-user",
      pageUrl: "https://giphy.com/gifs/AbCd1234",
    });
  });

  it("rejects a response without a data list", () => {
    expect(() => parseGiphyPage({ data: "nope" })).toThrow(failure("giphy.badResponse"));
  });

  it("derives pagination from the items when the response has none", () => {
    expect(parseGiphyPage({ data: [] })).toEqual({
      items: [],
      offset: 0,
      count: 0,
      totalCount: 0,
    });
  });
});

describe("fetching a page", () => {
  const apiKey = "key";
  const customerId = "customer";

  beforeEach(() => {
    fetchMock.mockResolvedValue(respond({ data: [] }));
  });

  it("lists trending GIFs for an empty query", async () => {
    await fetchGiphyPage({ apiKey, customerId, query: "   " });

    const { url, init } = lastRequest();
    expect(url.pathname).toBe("/v1/gifs/trending");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: "key",
      customer_id: "customer",
      limit: "24",
      offset: "0",
      rating: "pg-13",
    });
    expect(init).toMatchObject({ method: "GET", credentials: "omit" });
  });

  it("searches with a trimmed, shortened term in Polish", async () => {
    await fetchGiphyPage({ apiKey, customerId, query: ` ${"k".repeat(80)} ` });

    const { url } = lastRequest();
    expect(url.pathname).toBe("/v1/gifs/search");
    expect(url.searchParams.get("q")).toBe("k".repeat(50));
    expect(url.searchParams.get("lang")).toBe("pl");
  });

  it("keeps the page size and offset within what GIPHY accepts", async () => {
    await fetchGiphyPage({ apiKey, customerId, limit: 500, offset: -3 });
    expect(lastRequest().url.searchParams.get("limit")).toBe("50");
    expect(lastRequest().url.searchParams.get("offset")).toBe("0");

    await fetchGiphyPage({ apiKey, customerId, limit: 0 });
    expect(lastRequest().url.searchParams.get("limit")).toBe("1");
  });

  it("passes the abort signal on", async () => {
    const controller = new AbortController();

    await fetchGiphyPage({ apiKey, customerId, signal: controller.signal });

    expect(lastRequest().init.signal).toBe(controller.signal);
  });

  it("does not call GIPHY without a key", async () => {
    await expect(fetchGiphyPage({ apiKey: "", customerId })).rejects.toThrow(failure("giphy.keyMissing"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells a rate limit from any other failure", async () => {
    fetchMock.mockResolvedValueOnce(respond({}, { ok: false, status: 429 }));
    await expect(fetchGiphyPage({ apiKey, customerId })).rejects.toThrow(failure("giphy.rateLimited"));

    fetchMock.mockResolvedValueOnce(respond({}, { ok: false, status: 500 }));
    await expect(fetchGiphyPage({ apiKey, customerId })).rejects.toThrow(failure("giphy.fetchFailed"));
  });
});

describe("fetching one GIF", () => {
  it("refuses an id that could change the request path", async () => {
    await expect(fetchGiphyGif("key", "../trending", "customer")).rejects.toThrow(failure("giphy.badId"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the parsed GIF", async () => {
    fetchMock.mockResolvedValue(
      respond({ data: gif({ downsized: rendition("https://media.giphy.com/d.gif") }) }),
    );

    await expect(fetchGiphyGif("key", "AbCd1234", "customer")).resolves.toMatchObject({
      id: "AbCd1234",
      mediaUrl: "https://media.giphy.com/d.gif",
    });
    expect(lastRequest().url.pathname).toBe("/v1/gifs/AbCd1234");
  });

  it("reports a GIF that was removed and one that cannot be read", async () => {
    fetchMock.mockResolvedValueOnce(respond({}, { ok: false, status: 404 }));
    await expect(fetchGiphyGif("key", "AbCd1234", "customer")).rejects.toThrow(failure("giphy.gone"));

    fetchMock.mockResolvedValueOnce(respond({ data: { id: "AbCd1234" } }));
    await expect(fetchGiphyGif("key", "AbCd1234", "customer")).rejects.toThrow(failure("giphy.badGif"));
  });
});

describe("recognising a GIF link", () => {
  it.each([
    "https://giphy.com/gifs/AbCd1234/extra",
    "https://giphy.com/stickers/AbCd1234",
    "https://giphy.com/gifs/",
    "https://giphy.com/gifs/reaction-",
    "not a url",
  ])("finds no id in %s", (link) => {
    expect(giphyIdFromUrl(link)).toBeNull();
  });

  it("takes the id from the end of the slug and ignores the query string", () => {
    expect(giphyIdFromUrl("https://GIPHY.com/gifs/a-b-c-XyZ9?utm=1#top")).toBe("XyZ9");
  });
});

describe("reporting an action to GIPHY", () => {
  it("sends the customer id and a timestamp to the analytics host", async () => {
    fetchMock.mockResolvedValue(respond({}));

    await trackGiphyAction("https://giphy-analytics.giphy.com/ping?event=seen", "customer");

    const { url, init } = lastRequest();
    expect(url.searchParams.get("event")).toBe("seen");
    expect(url.searchParams.get("customer_id")).toBe("customer");
    expect(url.searchParams.get("ts")).toMatch(/^\d+$/);
    expect(init).toMatchObject({ credentials: "omit", keepalive: true });
  });

  it.each([
    undefined,
    "https://evil.example/ping",
    "http://giphy-analytics.giphy.com/ping",
    "https://giphy-analytics.giphy.com.evil.example/ping",
  ])("does not call %s", async (actionUrl) => {
    await trackGiphyAction(actionUrl, "customer");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));

    await expect(
      trackGiphyAction("https://giphy-analytics.giphy.com/ping", "customer"),
    ).resolves.toBeUndefined();
  });
});
