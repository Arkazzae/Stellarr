import { isValidElement, type ReactElement, type ReactNode } from "react";
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

import { LanguageProvider } from "@/state/LanguageProvider";

import RootLayout, { generateMetadata } from "./layout";

/** The first element of `type` anywhere under `node`. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  return node.type === type ? node : find(node.props["children"] as ReactNode, type);
}

describe("the root layout", () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.stubEnv("STELLARR_LANGUAGE", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders English when nobody chose a language", async () => {
    const page = (await RootLayout({ children: null })) as ReactElement<Record<string, unknown>>;

    expect(page.props["lang"]).toBe("en");
    expect(page.props["data-locale"]).toBe("en");
  });

  it("puts the language it resolved on <html> and gives it to the provider", async () => {
    vi.stubEnv("STELLARR_LANGUAGE", "pl");
    const instance = (await RootLayout({ children: null })) as ReactElement<Record<string, unknown>>;
    expect(instance.props["lang"]).toBe("pl");
    expect(find(instance, LanguageProvider)?.props["initialLocale"]).toBe("pl");

    cookieJar.set("stellarr_locale", "en");
    const chosen = (await RootLayout({ children: null })) as ReactElement<Record<string, unknown>>;
    expect(chosen.props["lang"]).toBe("en");
    expect(find(chosen, LanguageProvider)?.props["initialLocale"]).toBe("en");
  });

  it("describes the app in the language of the request", async () => {
    expect((await generateMetadata()).description).toBe("A small, self-hosted place to talk.");

    cookieJar.set("stellarr_locale", "pl");
    expect((await generateMetadata()).description).toBe(
      "Małe, samodzielnie hostowane miejsce na rozmowy.",
    );
  });
});
