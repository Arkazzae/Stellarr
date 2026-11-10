"use client";

import type { CSSProperties, ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Avatar } from "@/components/primitives/Avatar";
import { Segmented, type SegmentedOption } from "@/components/primitives/Segmented";
import {
  DEFAULT_THEME,
  DENSITIES,
  FONTS,
  PALETTES,
  SIZES,
  getPalette,
  paletteCssVariables,
  type ContrastPreference,
  type DensityPreference,
  type PaletteColors,
  type ResolvedScheme,
  type SchemePreference,
  type SizePreference,
  type ThemePreference,
} from "@/design/themes";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/hooks";

interface TokenGroup {
  title: MessageKey;
  icon: IconName;
  /** Message key of each role's name, and the colour it currently has. */
  tokens: readonly (readonly [MessageKey, string])[];
}

/**
 * Colour roles in the order a theme is built up: the chosen hue, the surfaces
 * it sits on, the text on those, the lines between them, and the four colours
 * that carry meaning.
 */
function tokenGroups(c: PaletteColors): readonly TokenGroup[] {
  return [
    {
      title: "theme.paletteAccent",
      icon: "sparkle",
      tokens: [["theme.paletteAccent", c.accent]],
    },
    {
      title: "theme.paletteBackgrounds",
      icon: "board",
      tokens: [
        ["theme.color.darkest", c.backgrounds.darkest],
        ["theme.color.dark", c.backgrounds.dark],
        ["theme.color.primary", c.backgrounds.primary],
        ["theme.color.secondary", c.backgrounds.secondary],
        ["theme.color.tertiary", c.backgrounds.tertiary],
        ["theme.color.hover", c.backgrounds.hover],
        ["theme.color.active", c.backgrounds.active],
        ["theme.color.floating", c.backgrounds.floating],
      ],
    },
    {
      title: "theme.paletteText",
      icon: "language",
      tokens: [
        ["theme.color.normal", c.text.normal],
        ["theme.color.muted", c.text.muted],
        ["theme.color.faint", c.text.faint],
      ],
    },
    {
      title: "theme.paletteBorders",
      icon: "sidebar",
      tokens: [
        ["theme.color.subtle", c.borders.subtle],
        ["theme.color.default", c.borders.default],
        ["theme.color.strong", c.borders.strong],
      ],
    },
    {
      title: "theme.paletteSemantic",
      icon: "warning",
      tokens: [
        ["theme.color.success", c.semantic.success],
        ["theme.color.warning", c.semantic.warning],
        ["theme.color.danger", c.semantic.danger],
        ["theme.color.info", c.semantic.info],
      ],
    },
  ];
}

function Card({
  icon,
  title,
  bodyClassName = "sc-b",
  decorative = false,
  children,
}: {
  icon: IconName;
  title: string;
  bodyClassName?: string;
  /** Hidden from assistive tech: the body describes nothing real. */
  decorative?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="sc">
      <header className="sc-h">
        <span className="sc-ico" aria-hidden="true">
          <Icon name={icon} size={17} />
        </span>
        {title}
      </header>
      <div className={bodyClassName} aria-hidden={decorative || undefined}>
        {children}
      </div>
    </section>
  );
}

/** A heading with its explanation, and the control that answers it below. */
function ChoiceRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="set-row col">
      <span className="set-lab">
        <b>{title}</b>
        <span>{detail}</span>
      </span>
      {children}
    </div>
  );
}

function Tick() {
  return (
    <span className="ap-tick" aria-hidden="true">
      <Icon name="tick" size={11} />
    </span>
  );
}

function PaletteInspector({
  colors,
  paletteLabel,
}: {
  colors: PaletteColors;
  paletteLabel: string;
}) {
  const { t } = useLanguage();
  return (
    <details className="ap-palette">
      <summary>
        {t("theme.fullPalette")} <span>{paletteLabel}</span>
      </summary>
      <div className="ap-token-groups">
        {tokenGroups(colors).map((group) => (
          <section key={group.title} className="ap-token-group">
            <h3>
              <span className="ap-token-ico" aria-hidden="true">
                <Icon name={group.icon} size={13} />
              </span>
              {t(group.title)}
            </h3>
            <ul>
              {group.tokens.map(([key, value]) => (
                // The full value stays on the tooltip so a long one never
                // decides the width of the board.
                <li key={key} title={`${t(key)}: ${value}`}>
                  <i style={{ background: value }} aria-hidden="true" />
                  <span>{t(key)}</span>
                  <code>{value}</code>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p>{t("theme.paletteNote")}</p>
    </details>
  );
}

/** Two invented people; read aloud they would sound like unread messages. */
function MessagePreview() {
  const { t } = useLanguage();
  return (
    <Card icon="eye" title={t("theme.preview")} bodyClassName="sc-b ap-preview" decorative>
      <div className="msg-group">
        <Avatar id="podglad-ada" displayName="Ada" />
        <div className="g-main">
          <p className="msg-head">
            <b>Ada</b>
            <time>19:04</time>
          </p>
          <p className="msg-body">{t("theme.previewMessageOne")}</p>
          <p className="msg-body">{t("theme.previewMessageTwo")}</p>
        </div>
      </div>
      <div className="msg-group">
        <Avatar id="podglad-nils" displayName="Nils" />
        <div className="g-main">
          <p className="msg-head">
            <b>Nils</b>
            <time>19:06</time>
          </p>
          <p className="msg-body">{t("theme.previewMessageThree")}</p>
        </div>
      </div>
    </Card>
  );
}

export interface AppearancePaneProps {
  /** The theme lives on the device, so the container passes `true`. */
  supported: boolean;
  theme: ThemePreference;
  /** Which of dark and light is actually in effect; the preset tiles follow it. */
  resolvedScheme: ResolvedScheme;
  onChange: (patch: Partial<ThemePreference>) => void;
  /** Every axis back to `DEFAULT_THEME`, in one write. */
  onReset: () => void;
}

/**
 * Two questions, in the order someone asks them: what colour is it, and how is
 * the text set.
 *
 * Nothing here names a colour or a face. A preset tile carries its own CSS
 * variables and `data-scheme`, and a face row carries `data-font`, so an entry
 * added to either registry paints its own preview.
 */
export function AppearancePane({
  supported,
  theme,
  resolvedScheme,
  onChange,
  onReset,
}: AppearancePaneProps) {
  const { t } = useLanguage();

  const schemeOptions: readonly SegmentedOption<SchemePreference>[] = [
    { value: "system", label: t("theme.scheme.system"), detail: t("theme.scheme.systemDetail") },
    { value: "dark", label: t("theme.scheme.dark"), detail: t("theme.scheme.darkDetail") },
    { value: "light", label: t("theme.scheme.light"), detail: t("theme.scheme.lightDetail") },
  ];
  const contrastOptions: readonly SegmentedOption<ContrastPreference>[] = [
    { value: "normal", label: t("theme.contrast.normal"), detail: t("theme.contrast.normalDetail") },
    { value: "high", label: t("theme.contrast.high"), detail: t("theme.contrast.highDetail") },
  ];
  const sizeOptions: readonly SegmentedOption<SizePreference>[] = SIZES.map(({ id }) => ({
    value: id,
    label: t(`theme.size.${id}`),
    detail: t(`theme.size.${id}Detail`),
  }));
  const densityOptions: readonly SegmentedOption<DensityPreference>[] = DENSITIES.map(({ id }) => ({
    value: id,
    label: t(`theme.density.${id}`),
    detail: t(`theme.density.${id}Detail`),
  }));

  const isDefault = (Object.keys(DEFAULT_THEME) as (keyof ThemePreference)[]).every(
    (axis) => theme[axis] === DEFAULT_THEME[axis],
  );
  const preset = getPalette(theme.palette);
  const accentIsPreset = theme.accent.toLowerCase() === preset.colors.accent.toLowerCase();

  return (
    <>
      <div className="ap-intro">
        <p className="set-note">{t("theme.appearanceNote")}</p>
        <button
          type="button"
          className="btn-ghost sm ap-reset"
          disabled={!supported || isDefault}
          onClick={onReset}
        >
          {t("common.resetDefaults")}
        </button>
      </div>

      <Card icon="sparkle" title={t("theme.theme")}>
        <div className="ap-themes" role="radiogroup" aria-label={t("theme.theme")}>
          {PALETTES.map((palette) => {
            const selected = palette.id === theme.palette;
            return (
              <button
                key={palette.id}
                type="button"
                role="radio"
                aria-checked={selected}
                title={t(`theme.palette.${palette.id}`)}
                disabled={!supported}
                className={selected ? "ap-tile on" : "ap-tile"}
                // The tile is a working instance of the theme it offers: these
                // attributes are the contract `applyThemeAttributes` themes the
                // document by, so everything inside resolves to its own tokens.
                data-theme={palette.id}
                data-scheme={resolvedScheme}
                data-contrast={theme.contrast}
                style={paletteCssVariables(palette) as CSSProperties}
                onClick={() => onChange({ palette: palette.id, accent: palette.colors.accent })}
              >
                <span className="ap-mini" aria-hidden="true">
                  <span className="ap-mini-rail">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="ap-mini-room">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="ap-name">{palette.label}</span>
                {selected ? <Tick /> : null}
              </button>
            );
          })}
        </div>

        <div className="set-row ap-accent-row">
          <label className="set-lab" htmlFor="theme-accent">
            <b>{t("theme.accentColor")}</b>
            <span>{t("theme.accentDetail")}</span>
          </label>
          <div className="ap-accent-control">
            <input
              id="theme-accent"
              type="color"
              value={theme.accent}
              aria-label={t("theme.accentColor")}
              disabled={!supported}
              onChange={(event) => onChange({ accent: event.currentTarget.value })}
            />
            <output htmlFor="theme-accent">{theme.accent}</output>
            <button
              type="button"
              className="btn-ghost sm"
              disabled={!supported || accentIsPreset}
              onClick={() => onChange({ accent: preset.colors.accent })}
            >
              {t("theme.themeColor")}
            </button>
          </div>
        </div>

        <ChoiceRow title={t("theme.brightness")} detail={t("theme.systemBrightnessDetail")}>
          <Segmented
            options={schemeOptions}
            value={theme.scheme}
            onChange={(scheme) => onChange({ scheme })}
            label={t("theme.brightness")}
            disabled={!supported}
            className="three"
          />
        </ChoiceRow>

        <ChoiceRow title={t("theme.contrast")} detail={t("theme.contrastDetail")}>
          <Segmented
            options={contrastOptions}
            value={theme.contrast}
            onChange={(contrast) => onChange({ contrast })}
            label={t("theme.contrast")}
            disabled={!supported}
          />
        </ChoiceRow>

        <PaletteInspector
          colors={{ ...preset.colors, accent: theme.accent }}
          paletteLabel={preset.label}
        />
      </Card>

      <MessagePreview />

      <Card icon="brush" title={t("theme.font")}>
        {/* A specimen sheet rather than a grid of cards: one row per face, set
            in that face. Its one-word character stays on the tooltip. */}
        <div className="ap-faces" role="radiogroup" aria-label={t("theme.fontFamily")}>
          {FONTS.map((font) => {
            const selected = font.id === theme.font;
            return (
              <button
                key={font.id}
                type="button"
                role="radio"
                aria-checked={selected}
                title={`${font.label}: ${t(`theme.font.${font.id}`)}`}
                disabled={!supported}
                className={selected ? "ap-face on" : "ap-face"}
                data-font={font.id}
                onClick={() => onChange({ font: font.id })}
              >
                <span className="ap-face-name">{font.label}</span>
                {selected ? <Tick /> : null}
              </button>
            );
          })}
        </div>

        <ChoiceRow title={t("theme.textSize")} detail={t("theme.textSizeDetail")}>
          <Segmented
            options={sizeOptions}
            value={theme.size}
            onChange={(size) => onChange({ size })}
            label={t("theme.textSize")}
            disabled={!supported}
            className="three"
          />
        </ChoiceRow>

        <ChoiceRow title={t("theme.density")} detail={t("theme.densityDetail")}>
          <Segmented
            options={densityOptions}
            value={theme.density}
            onChange={(density) => onChange({ density })}
            label={t("theme.density")}
            disabled={!supported}
          />
        </ChoiceRow>
      </Card>
    </>
  );
}
