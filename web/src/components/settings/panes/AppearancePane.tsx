"use client";

import type { CSSProperties, ReactNode } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { Segmented, type SegmentedOption } from "@/components/primitives/Segmented";
import { Switch } from "@/components/primitives/Switch";
import {
  DEFAULT_THEME,
  DENSITIES,
  PALETTES,
  SIZES,
  getPalette,
  paletteCssVariables,
  type ContrastPreference,
  type DensityPreference,
  type ResolvedScheme,
  type SchemePreference,
  type SizePreference,
  type ThemePreference,
} from "@/design/themes";
import { useLanguage } from "@/state/hooks";

function Card({
  title,
  bodyClassName = "sc-b",
  decorative = false,
  children,
}: {
  title: string;
  bodyClassName?: string;
  /** Hidden from assistive tech: the body describes nothing real. */
  decorative?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="sc">
      <header className="sc-h">
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

/** Two invented people; read aloud they would sound like unread messages. */
function MessagePreview() {
  const { t } = useLanguage();
  return (
    <Card title={t("theme.preview")} bodyClassName="sc-b ap-preview" decorative>
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

/**
 * What colour the app is, and how its conversation is set. The face itself is
 * the brand's and is not a choice.
 *
 * Nothing here names a colour. A preset tile carries its own CSS variables and
 * `data-scheme`, so an entry added to the registry paints its own preview.
 */
export function AppearancePane({
  theme,
  resolvedScheme,
  onChange,
  onReset,
  motion,
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

  const isDefault =
    (Object.keys(DEFAULT_THEME) as (keyof ThemePreference)[]).every(
      (axis) => theme[axis] === DEFAULT_THEME[axis],
    ) && motion?.reducedMotion !== true;

  // "Restore defaults" means everything this pane shows, motion included.
  const resetAll = () => {
    onReset();
    if (motion?.reducedMotion) motion.onChange(false);
  };
  const preset = getPalette(theme.palette);
  const accentIsPreset = theme.accent.toLowerCase() === preset.colors.accent.toLowerCase();

  return (
    <>
      <div className="ap-intro">
        <p className="set-note">{t("theme.appearanceNote")}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="ap-reset"
          disabled={isDefault}
          onClick={resetAll}
        >
          {t("common.resetDefaults")}
        </Button>
      </div>

      <Card title={t("theme.theme")}>
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
              onChange={(event) => onChange({ accent: event.currentTarget.value })}
            />
            <output htmlFor="theme-accent">{theme.accent}</output>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={accentIsPreset}
              onClick={() => onChange({ accent: preset.colors.accent })}
            >
              {t("theme.themeColor")}
            </Button>
          </div>
        </div>

        <ChoiceRow title={t("theme.brightness")} detail={t("theme.systemBrightnessDetail")}>
          <Segmented
            options={schemeOptions}
            value={theme.scheme}
            onChange={(scheme) => onChange({ scheme })}
            label={t("theme.brightness")}
            className="three"
          />
        </ChoiceRow>

        <ChoiceRow title={t("theme.contrast")} detail={t("theme.contrastDetail")}>
          <Segmented
            options={contrastOptions}
            value={theme.contrast}
            onChange={(contrast) => onChange({ contrast })}
            label={t("theme.contrast")}
          />
        </ChoiceRow>
      </Card>

      <MessagePreview />

      <Card title={t("theme.readability")}>
        <ChoiceRow title={t("theme.textSize")} detail={t("theme.textSizeDetail")}>
          <Segmented
            options={sizeOptions}
            value={theme.size}
            onChange={(size) => onChange({ size })}
            label={t("theme.textSize")}
            className="three"
          />
        </ChoiceRow>

        <ChoiceRow title={t("theme.density")} detail={t("theme.densityDetail")}>
          <Segmented
            options={densityOptions}
            value={theme.density}
            onChange={(density) => onChange({ density })}
            label={t("theme.density")}
          />
        </ChoiceRow>

        {motion === undefined ? null : (
          <div className="set-row">
            <span className="set-lab">
              <b>{t("preference.reducedMotion")}</b>
              <span>{t("preference.reducedMotionDetail")}</span>
              <span>{t("preference.reducedMotionNote")}</span>
            </span>
            <Switch
              checked={motion.reducedMotion}
              onChange={motion.onChange}
              label={t("preference.reducedMotion")}
            />
          </div>
        )}
      </Card>
    </>
  );
}
