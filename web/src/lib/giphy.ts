import type { MessageKey } from "@/i18n";

const API_ROOT = "https://api.giphy.com/v1/gifs";
const PAGE_HOSTS: ReadonlySet<string> = new Set(["giphy.com", "www.giphy.com"]);
const ANALYTICS_HOSTS: ReadonlySet<string> = new Set(["giphy-analytics.giphy.com"]);
const ID_PATTERN = /^[A-Za-z0-9]+$/;
const MAX_QUERY_LENGTH = 50;
const MAX_PAGE_SIZE = 50;

export interface GiphyAnalytics {
  onload?: string;
  onclick?: string;
  onsent?: string;
}

export interface GiphyGif {
  id: string;
  pageUrl: string;
  title: string;
  alt: string;
  username?: string;
  previewUrl: string;
  stillUrl?: string;
  mediaUrl: string;
  width: number;
  height: number;
  analytics: GiphyAnalytics;
}

export interface GiphyPage {
  items: GiphyGif[];
  offset: number;
  count: number;
  totalCount: number;
}

export interface GiphySearchOptions {
  apiKey: string;
  customerId: string;
  query?: string;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Why a GIPHY request failed. It names a catalog entry instead of holding a
 * sentence, because this module cannot know which language the reader wants;
 * whoever shows the failure translates the key.
 */
export class GiphyError extends Error {
  constructor(readonly messageKey: MessageKey) {
    super(messageKey);
    this.name = "GiphyError";
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** GIPHY sends sizes as strings, so digit strings count as numbers too. */
function wholeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return fallback;
}

/** An `https:` URL, optionally limited to a set of hosts. */
function httpsUrl(value: unknown, hosts?: ReadonlySet<string>): URL | undefined {
  const raw = nonEmptyString(value);
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    if (hosts !== undefined && !hosts.has(url.hostname.toLowerCase())) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

let pendingRuntimeKey: Promise<string> | null = null;

async function requestRuntimeKey(): Promise<string> {
  const response = await fetch("/api/config/giphy", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new GiphyError("giphy.configUnreadable");

  const payload = (await response.json()) as unknown;
  const apiKey = isRecord(payload) ? nonEmptyString(payload["apiKey"])?.trim() : undefined;
  if (!apiKey) throw new GiphyError("giphy.keyMissing");
  return apiKey;
}

/**
 * Uses the key bundled into a standalone frontend build, or asks Stellarr's
 * API for the one set when the container started, so changing only the
 * container environment is enough to enable GIFs.
 */
export function resolveGiphyApiKey(bundledKey: string): Promise<string> {
  const bundled = bundledKey.trim();
  if (bundled !== "") return Promise.resolve(bundled);

  if (pendingRuntimeKey === null) {
    const request = requestRuntimeKey();
    pendingRuntimeKey = request;
    // A temporary API failure must be retried the next time the picker opens,
    // not remembered for the lifetime of the tab.
    request.catch(() => {
      if (pendingRuntimeKey === request) pendingRuntimeKey = null;
    });
  }
  return pendingRuntimeKey;
}

interface Rendition {
  url: string;
  width: number;
  height: number;
}

function readRendition(images: JsonRecord, name: string, field = "url"): Rendition | undefined {
  const entry = images[name];
  if (!isRecord(entry)) return undefined;
  const url = httpsUrl(entry[field]);
  if (url === undefined) return undefined;
  return {
    url: url.toString(),
    width: Math.max(1, wholeNumber(entry["width"], 1)),
    height: Math.max(1, wholeNumber(entry["height"], 1)),
  };
}

function readAnalyticsUrl(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return httpsUrl(value["url"], ANALYTICS_HOSTS)?.toString();
}

/** Turns one untrusted item of a GIPHY response into the shape the UI uses. */
export function parseGiphyGif(value: unknown): GiphyGif | null {
  if (!isRecord(value) || !isRecord(value["images"])) return null;
  const id = nonEmptyString(value["id"]);
  if (id === undefined || !ID_PATTERN.test(id)) return null;

  const images = value["images"];
  const preview =
    readRendition(images, "fixed_width", "webp") ??
    readRendition(images, "fixed_width") ??
    readRendition(images, "downsized");
  const media =
    readRendition(images, "downsized") ??
    readRendition(images, "downsized_medium") ??
    readRendition(images, "original");
  if (preview === undefined || media === undefined) return null;

  const still =
    readRendition(images, "fixed_width_still") ??
    readRendition(images, "downsized_still");
  const title = nonEmptyString(value["title"]) ?? "GIF z GIPHY";
  const user = isRecord(value["user"]) ? value["user"] : {};
  const username = nonEmptyString(value["username"]) ?? nonEmptyString(user["username"]);
  const actions = isRecord(value["analytics"]) ? value["analytics"] : {};

  return {
    id,
    pageUrl:
      httpsUrl(value["url"], PAGE_HOSTS)?.toString() ?? `https://giphy.com/gifs/${id}`,
    title,
    alt: nonEmptyString(value["alt_text"]) ?? title,
    ...(username === undefined ? {} : { username }),
    previewUrl: preview.url,
    ...(still === undefined ? {} : { stillUrl: still.url }),
    mediaUrl: media.url,
    width: media.width,
    height: media.height,
    analytics: {
      onload: readAnalyticsUrl(actions["onload"]),
      onclick: readAnalyticsUrl(actions["onclick"]),
      onsent: readAnalyticsUrl(actions["onsent"]),
    },
  };
}

/** Parses a search or trending response, dropping the items that are unusable. */
export function parseGiphyPage(value: unknown): GiphyPage {
  if (!isRecord(value) || !Array.isArray(value["data"])) {
    throw new GiphyError("giphy.badResponse");
  }

  const data: unknown[] = value["data"];
  const pagination = isRecord(value["pagination"]) ? value["pagination"] : {};
  return {
    items: data.flatMap((item) => parseGiphyGif(item) ?? []),
    offset: wholeNumber(pagination["offset"]),
    count: wholeNumber(pagination["count"], data.length),
    totalCount: wholeNumber(pagination["total_count"], data.length),
  };
}

/** A GET to the GIPHY API that carries no cookies. */
function getFromGiphy(
  path: string,
  params: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const url = new URL(`${API_ROOT}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return fetch(url, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
    signal,
  });
}

/** Trending GIFs for an empty query, search results otherwise. */
export async function fetchGiphyPage({
  apiKey,
  customerId,
  query = "",
  offset = 0,
  limit = 24,
  signal,
}: GiphySearchOptions): Promise<GiphyPage> {
  if (apiKey === "") throw new GiphyError("giphy.keyMissing");

  const term = query.trim().slice(0, MAX_QUERY_LENGTH);
  const params: Record<string, string> = {
    api_key: apiKey,
    customer_id: customerId,
    limit: String(Math.min(MAX_PAGE_SIZE, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
    rating: "pg-13",
  };
  if (term !== "") {
    params["q"] = term;
    params["lang"] = "pl";
  }

  const response = await getFromGiphy(term === "" ? "trending" : "search", params, signal);
  if (!response.ok) {
    throw new GiphyError(response.status === 429 ? "giphy.rateLimited" : "giphy.fetchFailed");
  }
  return parseGiphyPage((await response.json()) as unknown);
}

export async function fetchGiphyGif(
  apiKey: string,
  id: string,
  customerId: string,
  signal?: AbortSignal,
): Promise<GiphyGif> {
  if (!ID_PATTERN.test(id)) throw new GiphyError("giphy.badId");

  const response = await getFromGiphy(
    id,
    { api_key: apiKey, customer_id: customerId, rating: "pg-13" },
    signal,
  );
  if (!response.ok) throw new GiphyError("giphy.gone");

  const payload = (await response.json()) as unknown;
  const gif = isRecord(payload) ? parseGiphyGif(payload["data"]) : null;
  if (gif === null) throw new GiphyError("giphy.badGif");
  return gif;
}

/**
 * The id of a GIF from its canonical page address, `https://giphy.com/gifs/<slug>-<id>`.
 * Media hosts and look-alike domains do not count.
 */
export function giphyIdFromUrl(value: string): string | null {
  const url = httpsUrl(value, PAGE_HOSTS);
  if (url === undefined) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const [section, slug] = segments;
  if (section !== "gifs" || segments.length !== 2 || slug === undefined) return null;
  return /(?:^|-)([A-Za-z0-9]+)$/.exec(slug)?.[1] ?? null;
}

/**
 * Reports a view, click or send to GIPHY. Only GIPHY's analytics host is
 * called, so a crafted response cannot turn this into an arbitrary request.
 */
export async function trackGiphyAction(
  actionUrl: string | undefined,
  customerId: string,
): Promise<void> {
  const target = httpsUrl(actionUrl, ANALYTICS_HOSTS);
  if (target === undefined) return;

  target.searchParams.set("customer_id", customerId);
  target.searchParams.set("ts", String(Date.now()));
  try {
    await fetch(target, { method: "GET", credentials: "omit", keepalive: true });
  } catch {
    // Analytics must never get in the way of browsing or sending a message.
  }
}
