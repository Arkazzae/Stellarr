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

interface Problem {
  code?: string;
  details?: Record<string, unknown>;
  /** The sentence the server wrote for the reader. */
  message?: string;
}

/**
 * Reads what an ASP.NET problem document says about a failure.
 *
 * `title` carries a machine-readable reason when it looks like one
 * (`pin_limit_reached`), `details` is an extension serialised at the root of the
 * document, `errors` is the shape of a validation problem, and `detail` is
 * free text. A body that is missing or not JSON yields an empty problem: the
 * status still says enough to fail on.
 */
async function readProblem(response: Response): Promise<Problem> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {};
  }
  if (!isRecord(payload)) return {};

  const problem: Problem = {};
  const title = payload["title"];
  if (typeof title === "string" && /^[a-z][a-z0-9_]*$/.test(title)) {
    problem.code = title;
  }
  const extensions = payload["extensions"];
  const details = isRecord(payload["details"])
    ? payload["details"]
    : isRecord(extensions)
      ? extensions["details"]
      : undefined;
  if (isRecord(details)) problem.details = details;

  // Only the first validation message is taken: these endpoints check one rule
  // at a time, and a list joined into a paragraph reads worse than the rule
  // that matters.
  const errors = payload["errors"];
  if (isRecord(errors)) {
    for (const messages of Object.values(errors)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") {
        problem.message = messages[0];
        return problem;
      }
    }
  }
  const detail = payload["detail"];
  if (typeof detail === "string" && detail.length > 0) problem.message = detail;
  return problem;
}

/**
 * Like `fail`, but carries the reason and facts the server gave, so a caller
 * can answer the reason rather than the status code.
 */
export async function failProblem(response: Response, path: string): Promise<never> {
  const { code, details } = await readProblem(response);
  throw new ApiError(
    statusToKind(response.status),
    `${path} responded ${response.status}`,
    response.status,
    { code, details },
  );
}

/** The server's own sentence for a refused request, or null when it sent none. */
export async function problemDetail(response: Response): Promise<string | null> {
  return (await readProblem(response)).message ?? null;
}
