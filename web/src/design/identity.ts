import type { CSSProperties } from "react";

/**
 * Per-person colour and artwork.
 *
 * A stable hash of the user id is the only input, so a person looks the same in
 * the rail, the roster and the transcript and in every session. Two people can
 * still land on the same hue; an avatar is not an identifier.
 */

/** FNV-1a: small, identical in every engine, and spreads short ids well. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Twelve stops around the wheel rather than a continuous hue, so neighbouring
 * people read as clearly different instead of as two shades of one colour.
 */
const HUE_STOPS = 12;
const HUE_OFFSET = 277;

/** How many avatar and banner pairs `public/identity/defaults` holds. */
export const DEFAULT_IDENTITY_ART_COUNT = 20;

export function hueFor(id: string): number {
  return (HUE_OFFSET + (stableHash(id) % HUE_STOPS) * (360 / HUE_STOPS)) % 360;
}

/**
 * The artwork pair for someone who has not uploaded their own. Nothing is
 * stored: the id picks the pair, so every surface agrees without a synthetic
 * profile URL in the database.
 */
export function defaultIdentityArt(id: string): {
  avatarUrl: string;
  bannerUrl: string;
} {
  const pair = String((stableHash(id) % DEFAULT_IDENTITY_ART_COUNT) + 1).padStart(
    2,
    "0",
  );
  return {
    avatarUrl: `/identity/defaults/${pair}/avatar.svg`,
    bannerUrl: `/identity/defaults/${pair}/banner.svg`,
  };
}

/** Avatar fill: dark enough that white initials clear 4.5:1. */
export function avatarColor(id: string): string {
  return `oklch(0.58 0.17 ${hueFor(id)})`;
}

/** Author name in the transcript: light enough to clear 4.5:1 on the canvas. */
export function nameColor(id: string): string {
  return `oklch(0.79 0.14 ${hueFor(id)})`;
}

/** Someone who is offline loses their hue, not just their opacity. */
export const OFFLINE_AVATAR = "oklch(0.42 0.015 var(--h-neutral))";

/**
 * The custom properties a person-scoped element sets. Spread onto `style` so
 * nested rules can use the colour without it being passed down as props.
 */
export function identityVars(id: string, offline = false): CSSProperties {
  return {
    "--person-bg": offline ? OFFLINE_AVATAR : avatarColor(id),
    "--person-name": offline ? "var(--text-faint)" : nameColor(id),
  } as CSSProperties;
}
