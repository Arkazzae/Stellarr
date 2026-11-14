/**
 * The theme registry.
 *
 * A theme is six independent choices, stored together and applied to `<html>`:
 *
 *   palette   the complete colour vocabulary    -> `data-theme` and CSS variables
 *   accent    an optional personal accent        -> `--palette-accent`
 *   scheme    dark, light, or follow the OS      -> `data-scheme`
 *   contrast  normal or high                     -> `data-contrast`
 *   size      how large message text is          -> `data-size`
 *   density   how much air a message gets        -> `data-density`
 *
 * A preset owns every colour role, not just a hue. Choosing one resets the
 * accent to the colour designed for it, but never changes type size or
 * density. The app itself is always set in Outfit, the brand's face.
 *
 * The palette data lives here so the runtime, the pre-hydration script, the
 * previews and the tests share one set of values. `recipe.css` maps this
 * vocabulary onto the semantic tokens components use.
 */

export interface PaletteColors {
  accent: string;
  backgrounds: {
    darkest: string;
    dark: string;
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
    active: string;
    floating: string;
  };
  text: {
    normal: string;
    muted: string;
    faint: string;
  };
  borders: {
    subtle: string;
    default: string;
    strong: string;
  };
  semantic: {
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
}

interface PaletteDefinition {
  id: string;
  label: string;
  colors: PaletteColors;
  /** Small metadata still needs AA contrast even when the raw "faint" swatch is decorative. */
  accessibleFaint: string;
}

/**
 * The accent of Midnight and Slate, and so of a fresh install. The fallback in
 * `recipe.css` and the fill in `app/icon.svg` cannot import it and repeat the
 * value; `themeAccent.test.ts` keeps the three in step.
 */
export const STELLARR_ACCENT = "#6f65d1";

export const PALETTES = [
  {
    id: "midnight",
    label: "Midnight",
    colors: {
      accent: STELLARR_ACCENT,
      backgrounds: {
        darkest: "#09090b",
        dark: "#18181b",
        primary: "#222327",
        secondary: "#18181b",
        tertiary: "#1e1f23",
        hover: "#27272a",
        active: "#33343a",
        floating: "#101113",
      },
      text: { normal: "#f3f4f6", muted: "#b9bec9", faint: "#747b89" },
      borders: {
        subtle: "rgba(255, 255, 255, 0.06)",
        default: "#292e39",
        strong: "rgba(255, 255, 255, 0.2)",
      },
      semantic: {
        success: "#3dd68c",
        warning: "#f0b232",
        danger: "#f2555a",
        info: "#6ea8fe",
      },
    },
    accessibleFaint: "#9aa0ad",
  },
  {
    id: "slate",
    label: "Slate",
    colors: {
      accent: STELLARR_ACCENT,
      backgrounds: {
        darkest: "#111214",
        dark: "#1e1f22",
        primary: "#2b2d31",
        secondary: "#1e1f22",
        tertiary: "#232428",
        hover: "#35373c",
        active: "#3f4147",
        floating: "#111214",
      },
      text: { normal: "#f2f3f5", muted: "#b5bac1", faint: "#80848e" },
      borders: {
        subtle: "rgba(255, 255, 255, 0.06)",
        default: "#3f4147",
        strong: "rgba(255, 255, 255, 0.2)",
      },
      semantic: {
        success: "#23a559",
        warning: "#f0b232",
        danger: "#f23f42",
        info: "#00a8fc",
      },
    },
    accessibleFaint: "#afb3bb",
  },
  {
    id: "evergreen",
    label: "Evergreen",
    colors: {
      accent: "#1db954",
      backgrounds: {
        darkest: "#0a0a0a",
        dark: "#121212",
        primary: "#1a1a1a",
        secondary: "#121212",
        tertiary: "#161616",
        hover: "#282828",
        active: "#333333",
        floating: "#0e0e0e",
      },
      text: { normal: "#e8e8e8", muted: "#a7a7a7", faint: "#6a6a6a" },
      borders: {
        subtle: "rgba(255, 255, 255, 0.06)",
        default: "#282828",
        strong: "rgba(255, 255, 255, 0.18)",
      },
      semantic: {
        success: "#1db954",
        warning: "#f0b232",
        danger: "#e91429",
        info: "#1db954",
      },
    },
    accessibleFaint: "#a0a0a0",
  },
  {
    id: "harbor",
    label: "Harbor",
    colors: {
      accent: "#1a9fff",
      backgrounds: {
        darkest: "#0e1116",
        dark: "#171a21",
        primary: "#1b2838",
        secondary: "#171a21",
        tertiary: "#192330",
        hover: "#2a475e",
        active: "#335573",
        floating: "#111419",
      },
      text: { normal: "#f1f1f1", muted: "#c7d5e0", faint: "#7d8b96" },
      borders: {
        subtle: "rgba(199, 213, 224, 0.08)",
        default: "#2a475e",
        strong: "rgba(102, 192, 244, 0.38)",
      },
      semantic: {
        success: "#75b022",
        warning: "#e5b13a",
        danger: "#d94126",
        info: "#66c0f4",
      },
    },
    accessibleFaint: "#d1d9df",
  },
  {
    id: "amethyst",
    label: "Amethyst",
    colors: {
      accent: "#9146ff",
      backgrounds: {
        darkest: "#0a0a0c",
        dark: "#0e0e10",
        primary: "#18181b",
        secondary: "#0e0e10",
        tertiary: "#141418",
        hover: "#26262c",
        active: "#323239",
        floating: "#0c0c0e",
      },
      text: { normal: "#efeff1", muted: "#adadb8", faint: "#7a7a85" },
      borders: {
        subtle: "rgba(255, 255, 255, 0.06)",
        default: "#35353b",
        strong: "rgba(255, 255, 255, 0.2)",
      },
      semantic: {
        success: "#00f593",
        warning: "#ffb31a",
        danger: "#eb0400",
        info: "#00c8ff",
      },
    },
    accessibleFaint: "#a4a4ae",
  },
  {
    id: "ink",
    label: "Ink",
    colors: {
      accent: "#58a6ff",
      backgrounds: {
        darkest: "#010409",
        dark: "#0d1117",
        primary: "#161b22",
        secondary: "#0d1117",
        tertiary: "#121820",
        hover: "#1f2937",
        active: "#272e38",
        floating: "#090c10",
      },
      text: { normal: "#f0f6fc", muted: "#b1bac4", faint: "#7d8590" },
      borders: {
        subtle: "rgba(240, 246, 252, 0.08)",
        default: "#30363d",
        strong: "#484f58",
      },
      semantic: {
        success: "#3fb950",
        warning: "#d29922",
        danger: "#f85149",
        info: "#58a6ff",
      },
    },
    accessibleFaint: "#a8b1bb",
  },
] as const satisfies readonly PaletteDefinition[];

type Palette = (typeof PALETTES)[number];
export type PaletteId = Palette["id"];

/** Only message text and the composer move; the chrome keeps its own scale. */
/**
 * Accents offered beside the theme's own. The presets' colours first, then
 * hues none of them has, so a swatch row reads as one wheel. Any other colour
 * is still a click away through the picker; these only spare the trip.
 */
export const ACCENT_SWATCHES = [
  { id: "indigo", hex: STELLARR_ACCENT },
  { id: "violet", hex: "#9146ff" },
  { id: "pink", hex: "#e93d82" },
  { id: "red", hex: "#e5484d" },
  { id: "orange", hex: "#f76b15" },
  { id: "green", hex: "#1db954" },
  { id: "teal", hex: "#12a594" },
  { id: "blue", hex: "#1a9fff" },
  { id: "sky", hex: "#58a6ff" },
] as const;

export type AccentSwatchId = (typeof ACCENT_SWATCHES)[number]["id"];

export const SIZES = [{ id: "sm" }, { id: "md" }, { id: "lg" }] as const;

export type SizePreference = (typeof SIZES)[number]["id"];

export const DENSITIES = [{ id: "cozy" }, { id: "compact" }] as const;

export type DensityPreference = (typeof DENSITIES)[number]["id"];

/** `system` follows `prefers-color-scheme` and keeps following it. */
export const SCHEMES = ["system", "dark", "light"] as const;
export type SchemePreference = (typeof SCHEMES)[number];
export type ResolvedScheme = "dark" | "light";

export const CONTRASTS = ["normal", "high"] as const;
export type ContrastPreference = (typeof CONTRASTS)[number];

export interface ThemePreference {
  palette: PaletteId;
  accent: string;
  scheme: SchemePreference;
  contrast: ContrastPreference;
  size: SizePreference;
  density: DensityPreference;
}

export const DEFAULT_THEME: ThemePreference = {
  palette: "midnight",
  accent: PALETTES[0].colors.accent,
  scheme: "dark",
  contrast: "normal",
  size: "md",
  density: "cozy",
};

/** One key holding one JSON object, so a partial write can never split the axes. */
export const THEME_STORAGE_KEY = "stellarr.theme";

/** Ids written by earlier versions, and the current id each one now means. */
export const LEGACY_PALETTES: Readonly<Record<string, PaletteId>> = {
  discord: "slate",
  spotify: "evergreen",
  steam: "harbor",
  twitch: "amethyst",
  "github-dark": "ink",
  indigo: "midnight",
  github: "ink",
  teal: "midnight",
  amber: "midnight",
  rose: "midnight",
  graphite: "midnight",
};

const PALETTE_IDS: readonly PaletteId[] = PALETTES.map(({ id }) => id);
const SIZE_IDS: readonly SizePreference[] = SIZES.map(({ id }) => id);
const DENSITY_IDS: readonly DensityPreference[] = DENSITIES.map(({ id }) => id);

export type ThemeCssVariables = Record<`--${string}`, string>;

export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) return null;
  return value.toLowerCase();
}

export function getPalette(id: PaletteId): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}

function relativeLuminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Picks black or white for controls filled with the user's accent. */
export function readableTextOn(hex: string): "#000000" | "#ffffff" {
  const luminance = relativeLuminance(hex);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff";
}

export function paletteCssVariables(
  palette: Palette,
  accent: string = palette.colors.accent,
): ThemeCssVariables {
  const { backgrounds, text, borders, semantic } = palette.colors;
  return {
    "--palette-accent": accent,
    "--palette-on-accent": readableTextOn(accent),
    "--palette-background-darkest": backgrounds.darkest,
    "--palette-background-dark": backgrounds.dark,
    "--palette-background-primary": backgrounds.primary,
    "--palette-background-secondary": backgrounds.secondary,
    "--palette-background-tertiary": backgrounds.tertiary,
    "--palette-background-hover": backgrounds.hover,
    "--palette-background-active": backgrounds.active,
    "--palette-background-floating": backgrounds.floating,
    "--palette-text-normal": text.normal,
    "--palette-text-muted": text.muted,
    "--palette-text-faint": text.faint,
    "--palette-text-faint-accessible": palette.accessibleFaint,
    "--palette-border-subtle": borders.subtle,
    "--palette-border-default": borders.default,
    "--palette-border-strong": borders.strong,
    "--palette-success": semantic.success,
    "--palette-warning": semantic.warning,
    "--palette-danger": semantic.danger,
    "--palette-info": semantic.info,
  };
}

export const PALETTE_CSS_VARIABLES = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, paletteCssVariables(palette)]),
) as Readonly<Record<PaletteId, ThemeCssVariables>>;

/** The id a stored value stands for, once an id from an older version is mapped. */
function migrate(table: Readonly<Record<string, string>>, value: unknown) {
  return typeof value === "string" && Object.hasOwn(table, value)
    ? table[value]
    : value;
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * Narrows anything read back from storage to a usable preference. Each axis
 * falls back on its own instead of the whole object being discarded, which is
 * what lets a preference written before a setting existed keep the others.
 */
export function normaliseTheme(input: unknown): ThemePreference {
  if (typeof input !== "object" || input === null) return DEFAULT_THEME;
  const raw = input as Partial<Record<keyof ThemePreference, unknown>>;

  const palette = oneOf(
    PALETTE_IDS,
    migrate(LEGACY_PALETTES, raw.palette),
    DEFAULT_THEME.palette,
  );
  return {
    palette,
    accent: normaliseHex(raw.accent) ?? getPalette(palette).colors.accent,
    scheme: oneOf(SCHEMES, raw.scheme, DEFAULT_THEME.scheme),
    contrast: oneOf(CONTRASTS, raw.contrast, DEFAULT_THEME.contrast),
    size: oneOf(SIZE_IDS, raw.size, DEFAULT_THEME.size),
    density: oneOf(DENSITY_IDS, raw.density, DEFAULT_THEME.density),
  };
}

export function resolveScheme(
  preference: SchemePreference,
  prefersDark: boolean,
): ResolvedScheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

/**
 * Writes every axis onto an element. The provider calls it at runtime; the
 * pre-hydration script produces the same result on `<html>` before first paint.
 */
export function applyThemeAttributes(
  element: HTMLElement,
  theme: ThemePreference,
  resolved: ResolvedScheme,
): void {
  const { dataset, style } = element;
  dataset.theme = theme.palette;
  dataset.scheme = resolved;
  dataset.contrast = theme.contrast;
  dataset.size = theme.size;
  dataset.density = theme.density;

  const palette = getPalette(theme.palette);
  const accent = normaliseHex(theme.accent) ?? palette.colors.accent;
  for (const [name, value] of Object.entries(
    paletteCssVariables(palette, accent),
  )) {
    style.setProperty(name, value);
  }
}
