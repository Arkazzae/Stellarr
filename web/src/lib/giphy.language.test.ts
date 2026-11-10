import { afterEach, describe, expect, it, vi } from "vitest";

import { translateMessage } from "@/i18n";

import { fetchGiphyGif, fetchGiphyPage, GiphyError, parseGiphyPage } from "./giphy";

function failureOf(run: () => unknown): unknown {
  try {
    run();
  } catch (failure) {
    return failure;
  }
  return undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GIPHY failures", () => {
  it.each([
    ["giphy.configUnreadable", "Nie udało się odczytać konfiguracji GIPHY."],
    ["giphy.keyMissing", "Brak klucza API GIPHY."],
    ["giphy.badResponse", "GIPHY zwróciło nieprawidłową odpowiedź."],
    ["giphy.rateLimited", "Limit zapytań GIPHY został wyczerpany. Spróbuj później."],
    ["giphy.fetchFailed", "Nie udało się pobrać GIF-ów z GIPHY."],
    ["giphy.badId", "Nieprawidłowy identyfikator GIF-a."],
    ["giphy.gone", "GIF nie jest już dostępny w GIPHY."],
    ["giphy.badGif", "GIPHY zwróciło nieprawidłowy GIF."],
  ] as const)("keep their Polish wording: %s", (key, sentence) => {
    expect(translateMessage("pl", key)).toBe(sentence);
  });

  it("name the catalog entry that words them, so no language is fixed here", () => {
    const failure = failureOf(() => parseGiphyPage(null));

    expect(failure).toBeInstanceOf(GiphyError);
    const { messageKey } = failure as GiphyError;
    expect(messageKey).toBe("giphy.badResponse");
    expect(translateMessage("en", messageKey)).toBe("GIPHY returned an invalid response.");
    expect(translateMessage("pl", messageKey)).toBe("GIPHY zwróciło nieprawidłową odpowiedź.");
  });

  it("name the reason for a refused id", async () => {
    await expect(fetchGiphyGif("key", "not an id!", "customer")).rejects.toMatchObject({
      messageKey: "giphy.badId",
    });
  });

  it("tell a rate limit from any other refusal", async () => {
    const respondWith = (status: number) =>
      vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status } as Response);
    const options = { apiKey: "key", customerId: "customer" };

    respondWith(429);
    await expect(fetchGiphyPage(options)).rejects.toMatchObject({
      messageKey: "giphy.rateLimited",
    });

    respondWith(500);
    await expect(fetchGiphyPage(options)).rejects.toMatchObject({
      messageKey: "giphy.fetchFailed",
    });
  });
});
