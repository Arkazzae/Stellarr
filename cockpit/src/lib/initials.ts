/**
 * The first letter of each of the first two words, upper-cased. Letters are
 * taken by code point, so a name that starts with an emoji or a letter outside
 * the basic plane keeps it whole.
 */
export function initialsOf(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  return initials.toLocaleUpperCase() || "?";
}
