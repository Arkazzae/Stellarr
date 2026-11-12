/**
 * Where a finished sign-in may send the visitor back to: a path on this
 * origin, such as `/cockpit/` or `/invite/abc`, and nothing else.
 *
 * The value arrives in the query string, so anyone can write it. `//host`,
 * `/\host` and their percent-encoded forms would leave the origin, as would
 * any scheme, so all of them are refused rather than repaired.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  for (const candidate of [raw, decoded]) {
    if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
    if (candidate.includes("\\")) return null;
    // Tabs and newlines are stripped by URL parsers, which can turn `/\t/host` into `//host`.
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return null;
  }
  const url = new URL(raw, "http://stellarr.invalid");
  if (url.origin !== "http://stellarr.invalid") return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
