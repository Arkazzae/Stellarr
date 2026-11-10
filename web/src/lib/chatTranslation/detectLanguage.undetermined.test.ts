import { describe, expect, it } from "vitest";

import { detectLanguage } from "./detectLanguage";

describe("chat language detection without enough text", () => {
  it.each(["👍", "ok", "   "])("answers und for %j", async (text) => {
    await expect(detectLanguage(text)).resolves.toBe("und");
  });
});
