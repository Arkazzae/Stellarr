/**
 * The theme registry.
 *
 * A theme is seven independent choices, stored together and applied to `<html>`:
 *
 *   palette   the complete colour vocabulary    -> `data-theme` and CSS variables
 *   accent    an optional personal accent        -> `--palette-accent`
 *   scheme    dark, light, or follow the OS      -> `data-scheme`
 *   contrast  normal or high                     -> `data-contrast`
 *   font      the face the app is set in         -> `data-font`
 *   size      how large message text is          -> `data-size`
 *   density   how much air a message gets        -> `data-density`
 *
 * A preset owns every colour role, not just a hue. Choosing one resets the
 * accent to the colour designed for it, but never changes typography or
 * density.
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
  description: string;
  colors: PaletteColors;
  /** Small metadata still needs AA contrast even when the raw "faint" swatch is decorative. */
  accessibleFaint: string;
}

export const PALETTES = [
  {
    id: "midnight",
    label: "Midnight",
    description: "Domyślny motyw Stellarr: ciepły grafit i spokojne indygo.",
    colors: {
      accent: "#5865f2",
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
    id: "discord",
    label: "Discord",
    description: "Blurple i chłodne grafity znane z Discorda.",
    colors: {
      accent: "#5865f2",
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
    id: "spotify",
    label: "Spotify",
    description: "Zielony akcent i neutralne, niemal czarne tła.",
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
    id: "steam",
    label: "Steam",
    description: "Stalowy błękit i głębokie, granatowe powierzchnie.",
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
    id: "twitch",
    label: "Twitch",
    description: "Wyrazisty fiolet na neutralnych, czarnych powierzchniach.",
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
    id: "github-dark",
    label: "GitHub Dark",
    description: "Grafitowy granat i niebieski akcent GitHuba.",
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

/**
 * Every face is self-hosted in `public/fonts`. Declaring a face costs nothing
 * until it is used, so the browser only fetches the selected family.
 */
export const FONTS = [
  { id: "outfit", label: "Outfit", detail: "Geometryczny, domyślny" },
  { id: "inter", label: "Inter", detail: "Neutralny, precyzyjny" },
  { id: "geist-sans", label: "Geist Sans", detail: "Techniczny, zwarty" },
  { id: "dm-sans", label: "DM Sans", detail: "Przyjazny, czytelny" },
  { id: "plus-jakarta-sans", label: "Plus Jakarta Sans", detail: "Nowoczesny, miękki" },
  { id: "manrope", label: "Manrope", detail: "Otwarty, geometryczny" },
  { id: "figtree", label: "Figtree", detail: "Naturalny, ekranowy" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", detail: "Techniczny, humanistyczny" },
  { id: "source-sans-3", label: "Source Sans 3", detail: "Spokojny, użytkowy" },
  { id: "noto-sans", label: "Noto Sans", detail: "Uniwersalny, wielojęzyczny" },
  { id: "open-sans", label: "Open Sans", detail: "Otwarty, znajomy" },
  { id: "lato", label: "Lato", detail: "Humanistyczny, polski" },
  { id: "poppins", label: "Poppins", detail: "Geometryczny, wyrazisty" },
  { id: "montserrat", label: "Montserrat", detail: "Szeroki, miejski" },
  { id: "raleway", label: "Raleway", detail: "Lekki, elegancki" },
  { id: "nunito", label: "Nunito", detail: "Miękki, zaokrąglony" },
  { id: "rubik", label: "Rubik", detail: "Zwarty, lekko zaokrąglony" },
  { id: "quicksand", label: "Quicksand", detail: "Lekki, przyjazny" },
  { id: "baloo-2", label: "Baloo 2", detail: "Pełny, swobodny" },
  { id: "varela-round", label: "Varela Round", detail: "Prosty, obły" },
  { id: "comfortaa", label: "Comfortaa", detail: "Miękki, geometryczny" },
  { id: "fira-code", label: "Fira Code", detail: "Mono, programistyczny" },
  { id: "jetbrains-mono", label: "JetBrains Mono", detail: "Mono, czytelny" },
  { id: "source-code-pro", label: "Source Code Pro", detail: "Mono, neutralny" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", detail: "Mono, techniczny" },
  { id: "space-grotesk", label: "Space Grotesk", detail: "Charakterny, ekranowy" },
  { id: "sora", label: "Sora", detail: "Cyfrowy, geometryczny" },
  { id: "lexend", label: "Lexend", detail: "Czytelny, przestronny" },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

/** Only message text and the composer move; the chrome keeps its own scale. */
export const SIZES = [
  { id: "sm", label: "Mniejszy", detail: "13,5 px" },
  { id: "md", label: "Normalny", detail: "15 px" },
  { id: "lg", label: "Większy", detail: "16,5 px" },
] as const;

export type SizePreference = (typeof SIZES)[number]["id"];

export const DENSITIES = [
  { id: "cozy", label: "Swobodna", detail: "Powietrze między wiadomościami" },
  { id: "compact", label: "Zwarta", detail: "Więcej rozmowy na ekranie" },
] as const;

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
  font: FontId;
  size: SizePreference;
  density: DensityPreference;
}

export const DEFAULT_THEME: ThemePreference = {
  palette: "midnight",
  accent: PALETTES[0].colors.accent,
  scheme: "dark",
  contrast: "normal",
  font: "outfit",
  size: "md",
  density: "cozy",
};

/** One key holding one JSON object, so a partial write can never split the axes. */
export const THEME_STORAGE_KEY = "stellarr.theme";

/** Ids written by earlier versions, and the current id each one now means. */
export const LEGACY_PALETTES: Readonly<Record<string, PaletteId>> = {
  indigo: "midnight",
  github: "github-dark",
  teal: "midnight",
  amber: "midnight",
  rose: "midnight",
  graphite: "midnight",
};

export const LEGACY_FONTS: Readonly<Record<string, FontId>> = {
  system: "outfit",
  grotesk: "inter",
  rounded: "nunito",
  serif: "source-sans-3",
  mono: "jetbrains-mono",
};

const PALETTE_IDS: readonly PaletteId[] = PALETTES.map(({ id }) => id);
const FONT_IDS: readonly FontId[] = FONTS.map(({ id }) => id);
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
 * what lets a preference written before the font pack existed keep its palette.
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
    font: oneOf(
      FONT_IDS,
      migrate(LEGACY_FONTS, raw.font),
      DEFAULT_THEME.font,
    ),
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
  dataset.font = theme.font;
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
