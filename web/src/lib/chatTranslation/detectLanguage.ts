import type { LanguageIdentifier } from "cld3-asm";

// Chat messages are short. Twenty bytes lets an ordinary sentence through while
// still refusing to guess from a lone emoji.
const MIN_BYTES = 20;
const MAX_BYTES = 2_000;

/** Below this probability an unreliable guess is treated as no answer. */
const MIN_UNRELIABLE_PROBABILITY = 0.15;

let identifier: Promise<LanguageIdentifier> | null = null;

function loadIdentifier(): Promise<LanguageIdentifier> {
  identifier ??= import("cld3-asm")
    .then(({ loadModule }) => loadModule())
    .then((factory) => factory.create(MIN_BYTES, MAX_BYTES))
    .catch((error) => {
      identifier = null;
      throw error;
    });
  return identifier;
}

/** ISO 639-1 where CLD3 is confident, otherwise `und`. */
export async function detectLanguage(text: string): Promise<string> {
  const guess = (await loadIdentifier()).findLanguage(text);
  return !guess.is_reliable && guess.probability < MIN_UNRELIABLE_PROBABILITY
    ? "und"
    : guess.language;
}
