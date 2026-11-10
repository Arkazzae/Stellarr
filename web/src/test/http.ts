import { afterEach, beforeEach, it, vi } from "vitest";
import { expect } from "vitest";
import type { Mock } from "vitest";

/**
 * Replaces `fetch` for the tests of a file, forgets the remembered server and
 * restores spies between tests. Call it once, at the top level of the file.
 */
export function mockFetch(): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    window.localStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  return fetchMock;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  /** The parsed JSON of a JSON body, the `FormData` of an upload, else undefined. */
  body: unknown;
}

/** What the nth call to `fetch` was asked to send. */
export function sentRequest(fetchMock: Mock<typeof fetch>, index = 0): SentRequest {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`);
  const [url, init] = call;
  const body = init?.body;
  return {
    url: String(url),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: typeof body === "string" ? (JSON.parse(body) as unknown) : body ?? undefined,
  };
}

export interface CallCase {
  name: string;
  run: () => Promise<unknown>;
  method: string;
  url: string;
  /** The JSON the call must send, or the form of an upload. */
  body?: unknown;
  /** What the server answers with; a 204 when the call reads no answer. */
  answer?: unknown;
}

/** Registers one test per case: the call must reach the server as described. */
export function itSendsCalls(fetchMock: Mock<typeof fetch>, cases: CallCase[]): void {
  it.each(cases)("sends $name", async ({ run, method, url, body, answer }) => {
    fetchMock.mockResolvedValue(answer === undefined ? noContent() : jsonResponse(answer));

    await run();

    const sent = sentRequest(fetchMock);
    expect({ method: sent.method, url: sent.url, body: sent.body }).toEqual({
      method,
      url,
      body,
    });
  });
}

/** Registers one test per call: whether a 404 on a delete counts as done. */
export function itAnswersMissingDeletes(
  fetchMock: Mock<typeof fetch>,
  calls: Record<string, () => Promise<unknown>>,
  tolerated: boolean,
): void {
  it.each(Object.entries(calls))(
    tolerated ? "%s counts a missing target as done" : "%s fails on a missing target",
    async (_name, run) => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

      if (tolerated) await expect(run()).resolves.toBeUndefined();
      else await expect(run()).rejects.toMatchObject({ kind: "not-found" });
    },
  );
}

/**
 * Registers one test per call that sends no body: the abort signal must reach
 * `fetch`, and it must not be mistaken for a body on the way.
 */
export function itForwardsTheSignal(
  fetchMock: Mock<typeof fetch>,
  calls: Record<string, (signal: AbortSignal) => Promise<unknown>>,
): void {
  it.each(Object.entries(calls))("%s hands its abort signal to the request", async (_name, run) => {
    fetchMock.mockResolvedValue(noContent());
    const controller = new AbortController();

    await run(controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(sentRequest(fetchMock).body).toBeUndefined();
  });
}
