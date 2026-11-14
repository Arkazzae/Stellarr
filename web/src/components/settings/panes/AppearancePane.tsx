"use client";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { Segmented, type SegmentedOption } from "@/components/primitives/Segmented";
import { Switch } from "@/components/primitives/Switch";
import {
  ACCENT_SWATCHES,
  DEFAULT_THEME,
  DENSITIES,
  PALETTES,
  SIZES,
  getPalette,
  paletteCssVariables,
  type DensityPreference,
  type ResolvedScheme,
  type SchemePreference,
  type SizePreference,
  type ThemePreference,
} from "@/design/themes";
import { useLanguage } from "@/state/hooks";

/**
 * Reduced motion. It is an account preference with its own owner rather than
 * an axis of the theme, but it answers the same question as contrast and text
 * size, how the app reads, so it is set here.
 */
export interface MotionPreferenceProps {
  reducedMotion: boolean;
  onChange: (reducedMotion: boolean) => void;
}

export interface AppearancePaneProps {
  theme: ThemePreference;
  /** Which of dark and light is actually in effect; the preset tiles follow it. */
  resolvedScheme: ResolvedScheme;
  onChange: (patch: Partial<ThemePreference>) => void;
  /** Every axis back to `DEFAULT_THEME`, in one write. */
  onReset: () => void;
  motion?: MotionPreferenceProps;
}

const SCHEME_ICONS: Record<SchemePreference, IconName> = {
  system: "monitor",
  dark: "moon",
  light: "sun",
};

/** The value of the swatch row for the theme's own colour. */
const THEME_ACCENT = "theme";

interface Swatch {
  value: string;
  hex: string;
  label: string;
  /** The theme's own colour, set apart from the curated ones by a rule. */
  theme?: boolean;
}

const ARROW_STEP: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * A row of colour swatches as one radio group: one tab stop, and the arrow
 * keys move and choose in the same step, like every other choice in the app.
 * A swatch is the colour itself, so the name is its accessible name and its
 * tooltip.
 */
function SwatchGroup({
  label,
  swatches,
  value,
  onChange,
}: {
  label: string;
  swatches: readonly Swatch[];
  value: string;
  onChange: (value: string) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = swatches.findIndex((swatch) => swatch.value === value);
  const tabStop = Math.max(selected, 0);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const step = ARROW_STEP[event.key];
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? swatches.length - 1
          : step === undefined
            ? null
            : (from + step + swatches.length) % swatches.length;
    const swatch = to === null ? undefined : swatches[to];
    if (to === null || swatch === undefined) return;
    event.preventDefault();
    buttons.current[to]?.focus();
    onChange(swatch.value);
  };

  return (
    <div className="ap-swatches" role="radiogroup" aria-label={label}>
      {swatches.map((swatch, index) => {
        const on = swatch.value === value;
        return (
          <button
            key={swatch.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={swatch.label}
            title={swatch.label}
            tabIndex={index === tabStop ? 0 : -1}
            className={["ap-acc", swatch.theme ? "theme" : "", on ? "on" : ""].filter(Boolean).join(" ")}
            style={{ "--sw": swatch.hex } as CSSProperties}
            onClick={() => onChange(swatch.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        );
      })}
    </div>
  );
}

/**
 * The app in miniature, drawn with the live tokens: a rail, a channel list,
 * and a room whose messages are the transcript's own markup. Every choice in
 * the pane shows here the moment it is made, text size and density included,
 * because the room is laid out by the rules that lay out the real one.
 */
function Stage() {
  const { t } = useLanguage();
  return (
    <figure className="ap-stage" aria-hidden="true">
      <div className="ap-stage-rail">
        <i className="on">ST</i>
        <i>DS</i>
        <i>GM</i>
      </div>
      <div className="ap-stage-side">
        <b>Stellarr</b>
        <span className="ap-stage-ch on">
          <em>#</em>
          {t("theme.stage.general")}
        </span>
        <span className="ap-stage-ch unread">
          <em>#</em>
          {t("theme.stage.design")}
        </span>
        <span className="ap-stage-ch">
          <em>#</em>
          {t("theme.stage.random")}
        </span>
        <span className="ap-stage-ch">
          <Icon name="sound" size={14} />
          {t("theme.stage.lobby")}
        </span>
      </div>
      <div className="ap-stage-room">
        <div className="ap-stage-head">
          <em>#</em>
          {t("theme.stage.general")}
        </div>
        <div className="ap-stage-feed">
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
              <p className="msg-body">
                <span className="msg-mention">@Ada</span> {t("theme.previewMessageThree")}
              </p>
            </div>
          </div>
        </div>
        <div className="ap-stage-composer">{t("theme.stage.composer")}</div>
      </div>
    </figure>
  );
}

/**
 * What colour the app is, and how its conversation is set. The face itself is
 * the brand's and is not a choice.
 *
 * The pane opens on the app in miniature, then the choices, one line each.
 * Nothing here names a colour: a preset tile carries its own CSS variables and
 * `data-scheme`, so an entry added to the registry paints its own swatch.
 */
export function AppearancePane({
  theme,
  resolvedScheme,
  onChange,
  onReset,
  motion,
}: AppearancePaneProps) {
  const { t } = useLanguage();

  const preset = getPalette(theme.palette);
  const accent = theme.accent.toLowerCase();
  const presetAccent = preset.colors.accent.toLowerCase();
  // The theme's own colour leads the row, and a curated colour the preset
  // already uses is not offered twice.
  const swatches = ACCENT_SWATCHES.filter((swatch) => swatch.hex.toLowerCase() !== presetAccent);
  const accentValue =
    accent === presetAccent
      ? THEME_ACCENT
      : (swatches.find((swatch) => swatch.hex.toLowerCase() === accent)?.id ?? "");
  const customAccent = accentValue === "";

  const accentSwatches: readonly Swatch[] = [
    { value: THEME_ACCENT, hex: preset.colors.accent, label: t("theme.themeColor"), theme: true },
    ...swatches.map((swatch) => ({
      value: swatch.id,
      hex: swatch.hex,
      label: t(`theme.accent.${swatch.id}`),
    })),
  ];

  const schemeOptions: readonly SegmentedOption<SchemePreference>[] = (
    ["system", "dark", "light"] as const
  ).map((value) => ({
    value,
    label: t(`theme.scheme.${value}`),
    title: t(`theme.scheme.${value}Detail`),
    leading: <Icon name={SCHEME_ICONS[value]} size={16} />,
  }));
  const sizeOptions: readonly SegmentedOption<SizePreference>[] = SIZES.map(({ id }) => ({
    value: id,
    label: t(`theme.size.${id}`),
    title: t(`theme.size.${id}Detail`),
    // The sample is set by the same token as the room, at the size it offers.
    leading: (
      <span className="ap-aa" data-size={id} aria-hidden="true">
        Aa
      </span>
    ),
  }));
  const densityOptions: readonly SegmentedOption<DensityPreference>[] = DENSITIES.map(({ id }) => ({
    value: id,
    label: t(`theme.density.${id}`),
    title: t(`theme.density.${id}Detail`),
  }));

  const isDefault =
    (Object.keys(DEFAULT_THEME) as (keyof ThemePreference)[]).every(
      (axis) => theme[axis] === DEFAULT_THEME[axis],
    ) && motion?.reducedMotion !== true;

  // "Restore defaults" means everything this pane shows, motion included.
  const resetAll = () => {
    onReset();
    if (motion?.reducedMotion) motion.onChange(false);
  };

  const pickAccent = (value: string) => {
    if (value === THEME_ACCENT) {
      onChange({ accent: preset.colors.accent });
      return;
    }
    const swatch = swatches.find((item) => item.id === value);
    if (swatch) onChange({ accent: swatch.hex });
  };

  return (
    <>
      <Stage />

      <section className="sc" aria-label={t("theme.theme")}>
        <header className="sc-h">{t("theme.theme")}</header>
        <div className="sc-b ap-theme">
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
                  className={selected ? "ap-tile on" : "ap-tile"}
                  // The tile is a working instance of the theme it offers:
                  // these attributes are the contract `applyThemeAttributes`
                  // themes the document by, so everything inside resolves to
                  // its own tokens.
                  data-theme={palette.id}
                  data-scheme={resolvedScheme}
                  data-contrast={theme.contrast}
                  style={paletteCssVariables(palette) as CSSProperties}
                  onClick={() => onChange({ palette: palette.id, accent: palette.colors.accent })}
                >
                  <span className="ap-sw" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <b />
                  </span>
                  <span className="ap-name">{palette.label}</span>
                  {selected ? (
                    <span className="ap-tick" aria-hidden="true">
                      <Icon name="tick" size={12} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="frm">
            <div className="frm-row ap-row">
              <span className="frm-lab">
                {t("theme.brightness")}
                <span>{t("theme.systemBrightnessDetail")}</span>
              </span>
              <div className="frm-ctl ap-end">
                <Segmented
                  options={schemeOptions}
                  value={theme.scheme}
                  onChange={(scheme) => onChange({ scheme })}
                  label={t("theme.brightness")}
                  variant="pill"
                  className="ap-seg"
                />
              </div>
            </div>

            <div className="frm-row ap-row">
              <span className="frm-lab">
                {t("theme.accentColor")}
                <span>{t("theme.accentDetail")}</span>
              </span>
              <div className="frm-ctl ap-end ap-accents">
                <SwatchGroup
                  label={t("theme.accentColor")}
                  swatches={accentSwatches}
                  value={accentValue}
                  onChange={pickAccent}
                />
                {/* Any other colour: the system picker, behind a hue wheel
                    that fills with the colour once it is the one in use. */}
                <label
                  className={customAccent ? "ap-acc custom on" : "ap-acc custom"}
                  style={{ "--sw": theme.accent } as CSSProperties}
                  title={t("theme.customAccent")}
                >
                  <input
                    type="color"
                    className="sr-only"
                    value={theme.accent}
                    aria-label={t("theme.customAccent")}
                    onChange={(event) => onChange({ accent: event.currentTarget.value })}
                  />
                </label>
              </div>
            </div>

            <div className="frm-row">
              <span className="frm-lab">
                {t("theme.highContrast")}
                <span>{t("theme.contrast.highDetail")}</span>
              </span>
              <div className="frm-ctl frm-switch">
                <Switch
                  checked={theme.contrast === "high"}
                  onChange={(high) => onChange({ contrast: high ? "high" : "normal" })}
                  label={t("theme.highContrast")}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sc" aria-label={t("theme.readability")}>
        <header className="sc-h">{t("theme.readability")}</header>
        <div className="sc-b">
          <div className="frm">
            <div className="frm-row ap-row">
              <span className="frm-lab">
                {t("theme.textSize")}
                <span>{t("theme.textSizeDetail")}</span>
              </span>
              <div className="frm-ctl ap-end">
                <Segmented
                  options={sizeOptions}
                  value={theme.size}
                  onChange={(size) => onChange({ size })}
                  label={t("theme.textSize")}
                  variant="pill"
                  className="ap-seg"
                />
              </div>
            </div>

            <div className="frm-row ap-row">
              <span className="frm-lab">
                {t("theme.density")}
                <span>{t("theme.densityDetail")}</span>
              </span>
              <div className="frm-ctl ap-end">
                <Segmented
                  options={densityOptions}
                  value={theme.density}
                  onChange={(density) => onChange({ density })}
                  label={t("theme.density")}
                  variant="pill"
                  className="ap-seg"
                />
              </div>
            </div>

            {motion === undefined ? null : (
              <div className="frm-row">
                <span className="frm-lab">
                  {t("preference.reducedMotion")}
                  <span>
                    {t("preference.reducedMotionDetail")} {t("preference.reducedMotionNote")}
                  </span>
                </span>
                <div className="frm-ctl frm-switch">
                  <Switch
                    checked={motion.reducedMotion}
                    onChange={motion.onChange}
                    label={t("preference.reducedMotion")}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="ap-foot">
        <p>{t("theme.appearanceNote")}</p>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          disabled={isDefault}
          onClick={resetAll}
        >
          <Icon name="refresh" size={15} />
          {t("common.resetDefaults")}
        </Button>
      </div>
    </>
  );
}
