import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { requestLocale } from "./requestLocale";

describe("requestLocale", () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.stubEnv("STELLARR_LANGUAGE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is English when the person and the operator chose nothing", async () => {
    vi.stubEnv("STELLARR_LANGUAGE", undefined);
    await expect(requestLocale()).resolves.toBe("en");
  });

  it("follows the operator's instance default", async () => {
    vi.stubEnv("STELLARR_LANGUAGE", "pl");
    await expect(requestLocale()).resolves.toBe("pl");
  });

  it("lets the person's remembered choice win over the instance default", async () => {
    vi.stubEnv("STELLARR_LANGUAGE", "pl");
    cookieJar.set("stellarr_locale", "en");
    await expect(requestLocale()).resolves.toBe("en");

    vi.stubEnv("STELLARR_LANGUAGE", "en");
    cookieJar.set("stellarr_locale", "pl");
    await expect(requestLocale()).resolves.toBe("pl");
  });

  it("ignores a cookie or a setting that names an unknown language", async () => {
    vi.stubEnv("STELLARR_LANGUAGE", "pl");
    cookieJar.set("stellarr_locale", "de");
    await expect(requestLocale()).resolves.toBe("pl");

    vi.stubEnv("STELLARR_LANGUAGE", "klingon");
    await expect(requestLocale()).resolves.toBe("en");
  });

  it("reads the setting on every request instead of once", async () => {
    vi.stubEnv("STELLARR_LANGUAGE", "pl");
    await expect(requestLocale()).resolves.toBe("pl");

    vi.stubEnv("STELLARR_LANGUAGE", "en");
    await expect(requestLocale()).resolves.toBe("en");
  });
});
