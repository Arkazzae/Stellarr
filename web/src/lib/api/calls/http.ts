import { expectArray } from "../expect";
import { ApiError, statusToKind } from "../errors";
import { fail, JSON_HEADERS, problemCode, readJson, request } from "../transport";

/**
 * The few shapes every HTTP call of the client comes down to, so the request
 * groups state a route, a body and a parser and nothing else. A failed
 * response is thrown as an `ApiError` by status; a success whose body does not
 * parse is `malformed`.
 */

export type Parse<T> = (value: unknown, path: string) => T;

type BodyMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export const ACCEPT_JSON: HeadersInit = { Accept: "application/json" };

/**
 * Builds a route with every interpolated value percent-encoded, so an id that
 * contains `/`, `?` or `%` stays one path segment.
 */
export function route(parts: TemplateStringsArray, ...values: string[]): string {
  return parts.reduce(
    (path, part, index) => path + encodeURIComponent(values[index - 1] ?? "") + part,
  );
}

/** Appends the parameters that are set; a route without any stays as it is. */
export function withQuery(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, String(value));
  }
  return query.size === 0 ? path : `${path}?${query.toString()}`;
}

/** Reads each element of an array payload with `parse`. */
export function parseList<T>(parse: Parse<T>): Parse<T[]> {
  return (value, path) =>
    expectArray(value, path).map((item) => parse(item, `${path}[]`));
}

function jsonInit(method: BodyMethod, body: unknown): RequestInit {
  return body === undefined
    ? { method, headers: ACCEPT_JSON }
    : { method, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

async function succeed(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await request(path, init, signal);
  if (!response.ok) await refuse(response, path);
  return response;
}

/**
 * Throws for a failed response. A refusal can say why, such as a second
 * step that is not fresh enough, and the error then carries that code.
 */
async function refuse(response: Response, path: string): Promise<never> {
  const code = response.status === 403 ? await problemCode(response) : null;
  if (code !== null) {
    throw new ApiError(statusToKind(403), `${path} responded 403`, 403, { code });
  }
  fail(response, path);
}

export async function getJson<T>(
  path: string,
  parse: Parse<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await succeed(path, { method: "GET", headers: ACCEPT_JSON }, signal);
  return parse(await readJson(response, path), path);
}

/** Sends `body` as JSON when there is one, and reads the JSON answer. */
export async function sendJson<T>(
  method: BodyMethod,
  path: string,
  body: unknown,
  parse: Parse<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await succeed(path, jsonInit(method, body), signal);
  return parse(await readJson(response, path), path);
}

/** A call whose answer is only that it succeeded. */
export async function sendVoid(
  method: BodyMethod,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<void> {
  await succeed(path, jsonInit(method, body), signal);
}

/**
 * Deletes something, where "already gone" is the outcome that was asked for:
 * a 404 is a success.
 */
export async function deleteResource(path: string, signal?: AbortSignal): Promise<void> {
  const response = await request(path, jsonInit("DELETE", undefined), signal);
  if (!response.ok && response.status !== 404) await refuse(response, path);
}

/**
 * A multipart form carrying `file` under the field name the server reads,
 * after the plain `fields` that describe it.
 */
export function fileForm(file: File, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", file, file.name);
  return form;
}

/** Posts a multipart form; the browser sets the content type and boundary. */
export async function postForm<T>(
  path: string,
  form: FormData,
  parse: Parse<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await succeed(
    path,
    { method: "POST", body: form, headers: ACCEPT_JSON },
    signal,
  );
  return parse(await readJson(response, path), path);
}
