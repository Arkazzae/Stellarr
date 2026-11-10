import { describe, expect, it } from "vitest";

import { detectLanguage } from "./detectLanguage";

describe("chat language detection", () => {
  it("recognises the two supported chat languages", async () => {
    await expect(
      detectLanguage("To jest dłuższa polska wiadomość wysłana na wspólnym kanale."),
    ).resolves.toBe("pl");
    await expect(
      detectLanguage("This is a longer English message posted in a shared channel."),
    ).resolves.toBe("en");
  });
});
