import { describe, expect, it } from "vitest";

import { translateMessage, type Translator } from "@/i18n";

import { ApiError, describeError } from "./errors";

describe("an API failure shown to a person", () => {
  const polish: Translator = (key, values) => translateMessage("pl", key, values);
  const english: Translator = (key, values) => translateMessage("en", key, values);

  it("comes out in the language of the translator it is given", () => {
    const failure = new ApiError("rate-limited", "x", 429);

    expect(describeError(failure, "fallback", polish)).toBe(
      "Za dużo prób. Odczekaj chwilę i spróbuj ponownie.",
    );
    expect(describeError(failure, "fallback", english)).toBe(
      "Too many attempts. Wait a moment and try again.",
    );
  });
});
