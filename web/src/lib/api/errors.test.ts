import { describe, expect, it } from "vitest";

import { translateMessage, type Translator } from "@/i18n";

import {
  ApiError,
  describeError,
  isUnauthorized,
  statusToKind,
  type ApiErrorKind,
} from "./errors";

describe("statusToKind", () => {
  it.each<[number, ApiErrorKind]>([
    [400, "invalid"],
    [422, "invalid"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [413, "too-large"],
    [415, "unsupported-media"],
    [429, "rate-limited"],
    [500, "server"],
    [503, "server"],
  ])("maps %i to %s", (status, kind) => {
    expect(statusToKind(status)).toBe(kind);
  });

  it("treats any other status as a server failure", () => {
    expect(statusToKind(0)).toBe("server");
    expect(statusToKind(409)).toBe("server");
  });
});

describe("ApiError", () => {
  it("carries the problem details only when the server sent them", () => {
    const plain = new ApiError("forbidden", "no", 403);
    expect(plain.code).toBeUndefined();
    expect(plain.details).toBeUndefined();

    const problem = new ApiError("invalid", "bad", 400, {
      code: "rate_window_open",
      details: { channelId: "c-1" },
    });
    expect(problem.code).toBe("rate_window_open");
    expect(problem.details).toEqual({ channelId: "c-1" });
  });

  it("defaults the status to 0 for failures without a response", () => {
    expect(new ApiError("network", "offline").status).toBe(0);
  });
});

describe("isUnauthorized", () => {
  it("recognises only an unauthorized ApiError", () => {
    expect(isUnauthorized(new ApiError("unauthorized", "x", 401))).toBe(true);
    expect(isUnauthorized(new ApiError("forbidden", "x", 403))).toBe(false);
    expect(isUnauthorized(new Error("401"))).toBe(false);
  });
});

describe("describeError", () => {
  const english: Translator = (key, values) => translateMessage("en", key, values);

  it("names the failure in the catalog language for an ApiError", () => {
    expect(describeError(new ApiError("network", "x"), "fallback", english)).toBe(
      "Could not connect to the server. Check your connection and try again.",
    );
    expect(
      describeError(new ApiError("too-large", "x", 413), "fallback", english),
    ).toBe("The attachment is too large.");
  });

  it("has a catalog message for every kind of ApiError", () => {
    const kinds: ApiErrorKind[] = [
      "network",
      "unauthorized",
      "forbidden",
      "not-found",
      "invalid",
      "too-large",
      "unsupported-media",
      "rate-limited",
      "server",
      "malformed",
    ];
    for (const kind of kinds) {
      const message = describeError(new ApiError(kind, "x"), "fallback", english);
      expect(message).not.toBe("fallback");
    }
  });

  it("returns the caller's fallback for anything else", () => {
    expect(describeError(new Error("boom"), "fallback", english)).toBe("fallback");
    expect(describeError("boom", "fallback", english)).toBe("fallback");
  });
});
