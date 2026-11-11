import { describe, expect, it } from "vitest";

import { pl } from "./pl";

const sources = import.meta.glob<string>(
  ["/src/**/*.{ts,tsx}", "!/src/i18n/**", "!/src/**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);

describe("the catalog", () => {
  it("has no key that the interface never asks for", () => {
    const code = Object.values(sources).join("\n");
    const unused = Object.keys(pl).filter((key) => !code.includes(`"${key}"`));

    expect(unused).toEqual([]);
  });
});
