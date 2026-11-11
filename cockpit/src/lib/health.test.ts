import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHealth } from "./health";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers each probe by path with a status code, or fails it with the given error. */
function answerWith(outcomes: Record<string, number | Error | DOMException>) {
  fetchMock.mockImplementation(async (input) => {
    const outcome = outcomes[String(input)];
    if (outcome === undefined) throw new Error(`unexpected probe ${String(input)}`);
    if (typeof outcome !== "number") throw outcome;
    return new Response(null, { status: outcome });
  });
}

describe("readHealth", () => {
  it("reports both checks healthy when both probes succeed", async () => {
    answerWith({ "/health/live": 200, "/health/ready": 200 });

    const snapshot = await readHealth();

    expect(snapshot.api).toBe("healthy");
    expect(snapshot.database).toBe("healthy");
    expect(snapshot.checkedAt).toBeInstanceOf(Date);
  });

  it("maps api to the live probe and database to the ready probe", async () => {
    answerWith({ "/health/live": 200, "/health/ready": 503 });
    await expect(readHealth()).resolves.toMatchObject({ api: "healthy", database: "unavailable" });

    answerWith({ "/health/live": 500, "/health/ready": 200 });
    await expect(readHealth()).resolves.toMatchObject({ api: "unavailable", database: "healthy" });
  });

  it("counts a network error as unavailable without failing the other probe", async () => {
    answerWith({ "/health/live": new TypeError("Failed to fetch"), "/health/ready": 200 });

    await expect(readHealth()).resolves.toMatchObject({ api: "unavailable", database: "healthy" });
  });

  it("asks for JSON and forwards the abort signal to both probes", async () => {
    answerWith({ "/health/live": 200, "/health/ready": 200 });
    const controller = new AbortController();

    await readHealth(controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({ Accept: "application/json" });
      expect(init?.signal).toBe(controller.signal);
    }
  });

  it("starts both probes before either one has answered", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));

    void readHealth();

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/health/live",
      "/health/ready",
    ]);
  });

  it("rethrows an abort instead of reporting the service as unavailable", async () => {
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    answerWith({ "/health/live": 200, "/health/ready": aborted });

    await expect(readHealth()).rejects.toBe(aborted);
  });
});
