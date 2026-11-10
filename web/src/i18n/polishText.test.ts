import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const POLISH_LETTER = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** Interface text is written once per language, in the catalogs. */
const isCatalog = (path: string) => path.startsWith("i18n/messages/");

/** Tests and the fixtures they share assert Polish text on purpose. */
const isTestCode = (path: string) =>
  /\.test\.tsx?$/.test(path) || path.startsWith("test/") || /Fixtures\.ts$/.test(path);

/**
 * The few lines outside the catalogs that need a Polish letter, and why. Each
 * is data or a rule about data, not text a person reads.
 */
const ALLOWED = [
  {
    file: "lib/format.ts",
    line: "[^a-z0-9ąćęłńóśźż-]",
    why: "a channel name keeps the Polish letters, as the server stores it",
  },
  {
    file: "lib/emoji.ts",
    line: '.replaceAll("ł", "l")',
    why: "search folds diacritics, and this letter has no decomposition",
  },
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(SRC)
  .map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }))
  .filter(({ path }) => !isCatalog(path) && !isTestCode(path));

const isAllowed = (path: string, line: string) =>
  ALLOWED.some((entry) => entry.file === path && line.includes(entry.line));

describe("Polish text in the source", () => {
  it("lives in the catalogs, so English can be the default", () => {
    const strays = files.flatMap(({ path, text }) =>
      text
        .split("\n")
        .map((line, index) => ({ at: `${path}:${index + 1}`, path, line }))
        .filter(({ path, line }) => POLISH_LETTER.test(line) && !isAllowed(path, line))
        .map(({ at, line }) => `${at}  ${line.trim()}`),
    );

    expect(strays).toEqual([]);
  });

  it("is allowed only where the allowance still applies", () => {
    for (const entry of ALLOWED) {
      const file = files.find(({ path }) => path === entry.file);
      expect(file?.text, `${entry.file} (${entry.why})`).toContain(entry.line);
    }
  });
});
