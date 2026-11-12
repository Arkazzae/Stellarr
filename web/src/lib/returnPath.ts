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
    if (!leadsHere(candidate)) return null;
    // Tabs and newlines are stripped by URL parsers, which can turn `/\t/host` into `//host`.
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return null;
    // The parser folds "." and ".." segments, so `/.//host` would come out as
    // `//host`. No page of the app has such a segment; refuse them outright.
    if (/(^|\/)\.{1,2}(\/|$|[?#])/.test(candidate.split(/[?#]/, 1)[0] ?? "")) return null;
  }
  const url = new URL(raw, "http://stellarr.invalid");
  if (url.origin !== "http://stellarr.invalid") return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Checked again after parsing: the path that is followed is this one.
  return leadsHere(path) ? path : null;
}

/** A rooted path that a browser cannot read as another host. */
function leadsHere(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}
