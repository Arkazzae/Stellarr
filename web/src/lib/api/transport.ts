import { ApiError, statusToKind } from "./errors";
import { isRecord } from "./expect";

/** Where the browser remembers which server the account is working in. */
export const ACTIVE_SERVER_STORAGE_KEY = "stellarr.active-server";

export const JSON_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

/**
 * Who is calling.
 *
 * The instance only serves clients it recognises (`ClientGate` on the server),
 * so a stale build of a previous product still installed somewhere cannot sign
 * in against an API it no longer agrees with. The desktop and Android shells
 * identify themselves in their own native HTTP layer, which owns these two
 * headers and strips whatever the page set.
 */
const CLIENT_KIND = "web";
/** Kept in step with `package.json`; the server parses it as a version. */
const CLIENT_VERSION = "2.0.0";

export function readActiveServerId(): string | undefined {
  try {
    return window.localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY) ?? undefined;
  } catch {
    // No `window` while prerendering, and storage throws when it is blocked.
    return undefined;
  }
}

/** Remembers the server the account is working in; best effort, like the read. */
export function rememberActiveServerId(serverId: string): void {
  try {
    window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, serverId);
  } catch {
    // Without storage the server falls back to the account's default.
  }
}

export function forgetActiveServerId(): void {
  try {
    window.localStorage.removeItem(ACTIVE_SERVER_STORAGE_KEY);
  } catch {
    // Nothing was remembered if nothing can be stored.
  }
}

/**
 * Sends one same-origin request, identified as this client.
 *
 * Calls under `/api/` are addressed to the active server. A failure to get any
 * answer is a `network` error; an abort is passed through untouched so callers
 * can tell a cancelled request from a failed one.
 */
export async function request(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Stellarr-Client", CLIENT_KIND);
  headers.set("X-Stellarr-Client-Version", CLIENT_VERSION);
  const serverId = path.startsWith("/api/") ? readActiveServerId() : undefined;
  if (serverId !== undefined) headers.set("X-Stellarr-Server", serverId);

  try {
    return await fetch(path, {
      // The session cookie is HttpOnly and same-origin; credentials must never
      // go cross-origin.
      credentials: "same-origin",
      redirect: "error",
      ...init,
      headers,
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // By name rather than `instanceof`: the error may come from another realm
    // (a frame, a polyfill) where its class is not ours.
    if (isRecord(cause) && cause["name"] === "AbortError") throw cause;
    throw new ApiError("network", `Request to ${path} failed`, 0);
  }
}

export async function readJson(response: Response, path: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiError(
      "malformed",
      `Response from ${path} was not valid JSON`,
      response.status,
    );
  }
}

/** Throws the `ApiError` for a failed response, classified by its status. */
export function fail(response: Response, path: string): never {
  throw new ApiError(
    statusToKind(response.status),
    `${path} responded ${response.status}`,
    response.status,
  );
}

/**
 * The first sentence out of an ASP.NET problem document, or null.
 *
 * `errors` is the shape of a validation problem (`{ errors: { field: ["…"] } }`)
 * and `detail` is free text. Only the first validation message is taken: these
 * endpoints check one rule at a time, and a list joined into a paragraph reads
 * worse than the rule that matters. A body that is missing or not JSON yields
 * null, and the caller has a fallback.
 */
export async function problemDetail(response: Response): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;

  const errors = payload["errors"];
  if (isRecord(errors)) {
    for (const messages of Object.values(errors)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") {
        return messages[0];
      }
    }
  }
  const detail = payload["detail"];
  return typeof detail === "string" && detail.length > 0 ? detail : null;
}
