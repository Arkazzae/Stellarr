import type { IconPath } from "./paths";

/**
 * Iconsax shapes (MIT, iconsax.io) that Cockpit needs and the web client does
 * not. They live here so paths.ts stays an unchanged copy of the web client's.
 */
export const COCKPIT_ICON_PATHS = {
  /** Iconsax refresh-2: two arrows chasing each other round a circle. */
  refresh: [
    "M22 12C22 17.52 17.52 22 12 22C6.48 22 3.11 16.44 3.11 16.44",
    "M3.11 16.44H7.63V21.44",
    "M2 12C2 6.44 6.44 2 12 2C18.67 2 22 7.56 22 7.56",
    "M22 2.56V7.56H17.56",
  ],
  /** Iconsax info-circle: an i in a ring, for a note that opens on hover. */
  info: [
    "M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z",
    "M12 8V13",
    "M11.9945 16H12.0035",
  ],
} as const satisfies Record<string, readonly IconPath[]>;
