const DEFAULT_ART_COUNT = 20;

/**
 * 32-bit FNV-1a over the UTF-16 code units of the id. The web client picks its
 * default pictures with the same hash (web/src/design/identity.ts), so a person
 * gets the same default avatar in the panel and in the app.
 */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The avatar shown for someone without their own, served by the web client at the site root. */
export function defaultAvatarUrl(id: string): string {
  const number = (fnv1a(id) % DEFAULT_ART_COUNT) + 1;
  return `/identity/defaults/${String(number).padStart(2, "0")}/avatar.svg`;
}
