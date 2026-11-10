import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { version as PACKAGE_VERSION } from "../../../package.json";
import { ApiError } from "./errors";
import {
  ACTIVE_SERVER_STORAGE_KEY,
  fail,
  forgetActiveServerId,
  JSON_HEADERS,
  problemDetail,
  readActiveServerId,
  readJson,
  rememberActiveServerId,
  request,
} from "./transport";

const fetchMock = vi.fn<typeof fetch>();

function problem(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

function sentInit(): RequestInit {
  const init = fetchMock.mock.calls[0]?.[1];
  if (!init) throw new Error("fetch was not called");
  return init;
}

function sentHeaders(): Headers {
  return new Headers(sentInit().headers);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("request", () => {
  it("identifies the web client and keeps credentials same-origin", async () => {
    await request("/api/session", { method: "GET" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session");
    const headers = sentHeaders();
    expect(headers.get("X-Stellarr-Client")).toBe("web");
    expect(sentInit().credentials).toBe("same-origin");
    expect(sentInit().redirect).toBe("error");
    expect(sentInit().method).toBe("GET");
  });

  it("reports the version the package declares, which the server parses", async () => {
    await request("/api/session", {});

    expect(sentHeaders().get("X-Stellarr-Client-Version")).toBe(PACKAGE_VERSION);
  });

  it("keeps the headers the caller set", async () => {
    await request("/api/me", { method: "PATCH", headers: JSON_HEADERS, body: "{}" });

    const headers = sentHeaders();
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Stellarr-Client")).toBe("web");
  });

  it("hands the abort signal to fetch", async () => {
    const controller = new AbortController();

    await request("/api/bootstrap", {}, controller.signal);

    expect(sentInit().signal).toBe(controller.signal);
  });

  it("returns the response without judging its status", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    const response = await request("/api/bootstrap", {});

    expect(response.status).toBe(500);
  });

  it("turns a failure to get any answer into a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await caught(request("/api/session", {}));

    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
  });

  it("passes an abort through so a cancelled request is not a failed one", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    fetchMock.mockRejectedValue(abort);

    await expect(request("/api/session", {})).rejects.toBe(abort);
  });

  describe("addressing the active server", () => {
    it("sends the stored server with calls under /api/", async () => {
      window.localStorage.setItem("stellarr.active-server", "srv-orbit");

      await request("/api/channels/c-1/messages", {});

      expect(sentHeaders().get("X-Stellarr-Server")).toBe("srv-orbit");
    });

    it("keeps the active server under the stellarr.active-server key", () => {
      expect(ACTIVE_SERVER_STORAGE_KEY).toBe("stellarr.active-server");
      window.localStorage.setItem("stellarr.active-server", "srv-orbit");

      expect(readActiveServerId()).toBe("srv-orbit");
    });

    it("follows the stored server as it changes", async () => {
      window.localStorage.setItem("stellarr.active-server", "srv-orbit");
      await request("/api/bootstrap", {});
      window.localStorage.setItem("stellarr.active-server", "srv-lagoon");
      await request("/api/bootstrap", {});

      const servers = fetchMock.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("X-Stellarr-Server"),
      );
      expect(servers).toEqual(["srv-orbit", "srv-lagoon"]);
    });

    it("sends no server before one has been chosen", async () => {
      await request("/api/bootstrap", {});

      expect(sentHeaders().has("X-Stellarr-Server")).toBe(false);
    });

    it("does not address paths outside /api/ to a server", async () => {
      window.localStorage.setItem("stellarr.active-server", "srv-orbit");

      await request("/assets/avatar", {});

      expect(sentHeaders().has("X-Stellarr-Server")).toBe(false);
    });

    it("still sends the request when storage cannot be read", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });

      await request("/api/bootstrap", {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentHeaders().has("X-Stellarr-Server")).toBe(false);
    });
  });
});

describe("remembering the active server", () => {
  it("keeps the server for the next read and forgets it on request", () => {
    rememberActiveServerId("srv-orbit");
    expect(readActiveServerId()).toBe("srv-orbit");

    forgetActiveServerId();
    expect(readActiveServerId()).toBeUndefined();
  });

  it("carries on when storage refuses to be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => rememberActiveServerId("srv-orbit")).not.toThrow();
    expect(() => forgetActiveServerId()).not.toThrow();
  });
});

describe("readJson", () => {
  it("parses a JSON body", async () => {
    const body = await readJson(new Response('{"ok":true}'), "/api/x");

    expect(body).toEqual({ ok: true });
  });

  it("reports a body that is not JSON as malformed, with the response status", async () => {
    const error = await caught(readJson(new Response("<html>", { status: 200 }), "/api/x"));

    expect(error.kind).toBe("malformed");
    expect(error.status).toBe(200);
    expect(error.message).toContain("/api/x");
  });
});

describe("fail", () => {
  it.each([
    [400, "invalid"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [413, "too-large"],
    [429, "rate-limited"],
    [502, "server"],
  ])("classifies a %i response as %s", (status, kind) => {
    let thrown: unknown;
    try {
      fail(new Response(null, { status }), "/api/x");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).kind).toBe(kind);
    expect((thrown as ApiError).status).toBe(status);
    expect((thrown as ApiError).message).toBe(`/api/x responded ${status}`);
    expect((thrown as ApiError).code).toBeUndefined();
  });
});

describe("problemDetail", () => {
  it("takes the first validation message", async () => {
    const detail = await problemDetail(
      problem({ errors: { name: ["Nazwa jest za długa.", "Druga."], other: ["Trzecia."] } }),
    );

    expect(detail).toBe("Nazwa jest za długa.");
  });

  it("skips fields that carry no message", async () => {
    const detail = await problemDetail(problem({ errors: { empty: [], name: ["Pierwsza."] } }));

    expect(detail).toBe("Pierwsza.");
  });

  it("falls back to the detail sentence", async () => {
    const detail = await problemDetail(problem({ detail: "Kanał ma już 50 przypiętych." }));

    expect(detail).toBe("Kanał ma już 50 przypiętych.");
  });

  it("is null when the server said nothing usable", async () => {
    expect(await problemDetail(problem({ detail: "" }))).toBeNull();
    expect(await problemDetail(problem([]))).toBeNull();
    expect(await problemDetail(new Response("oops", { status: 400 }))).toBeNull();
  });
});
