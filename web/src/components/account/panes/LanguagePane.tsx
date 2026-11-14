"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";
import { Segmented } from "@/components/primitives/Segmented";
import { Switch } from "@/components/primitives/Switch";
import { useRovingRadio } from "@/components/primitives/useRovingRadio";
import {
  SUPPORTED_LOCALES,
  type InterfaceLocale,
  type LanguageSettings,
  type TranslationTargetLanguage,
  type Translator,
} from "@/i18n";
import {
  useModelStatus,
  type ModelDownloadState,
} from "@/lib/chatTranslation/useModelStatus";

import { FormRow } from "./VoiceFields";

/** Each language is always shown in its own tongue, whatever the interface speaks. */
const NATIVE_NAMES: Record<InterfaceLocale, string> = {
  pl: "Polski",
  en: "English",
};

/**
 * How much of the app a language covers, once packs come from the server.
 * A language missing here is complete.
 */
const COVERAGE: Partial<Record<InterfaceLocale, number>> = {};

/** Below this many languages the list reads at a glance and needs no search. */
const SEARCH_FROM = 9;

/**
 * What changing the language changes, shown rather than described: one fixed
 * moment written the way the language writes dates.
 */
const SAMPLE_MOMENT = new Date(2026, 10, 14, 19, 4);

function sampleDate(locale: InterfaceLocale): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(SAMPLE_MOMENT);
}

/** Case and accents aside, so "cestina" finds Čeština. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export interface LanguagePaneProps extends LanguageSettings {
  update: (patch: Partial<LanguageSettings>) => void;
  t: Translator;
}

interface ToggleRowProps {
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, detail, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <FormRow label={label} detail={detail} controlClass="frm-switch">
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </FormRow>
  );
}

interface LanguageListProps {
  label: string;
  value: InterfaceLocale;
  t: Translator;
  onChange: (locale: InterfaceLocale) => void;
}

/**
 * The interface languages as one list: a row a language, so more languages
 * are more rows. The chosen row shows what it changes, a date written its
 * way; a language that covers only part of the app says how much. Once the
 * list is long it searches.
 */
function LanguageList({ label, value, t, onChange }: LanguageListProps) {
  const [query, setQuery] = useState("");
  const searchable = SUPPORTED_LOCALES.length >= SEARCH_FROM;
  const needle = fold(query.trim());
  const shown = SUPPORTED_LOCALES.filter(
    (code) =>
      needle === "" ||
      fold(`${NATIVE_NAMES[code]} ${t(`language.name.${code}`)} ${code}`).includes(needle),
  );
  const roving = useRovingRadio(
    shown.length,
    shown.indexOf(value),
    (index) => onChange(shown[index]!),
  );

  return (
    <div className="sc-b lang-list">
      {searchable ? (
        <label className="lang-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            placeholder={t("language.search")}
            aria-label={t("language.search")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}
      <div className="lang-rows" role="radiogroup" aria-label={label}>
        {shown.length === 0 ? (
          <p className="lang-empty">{t("language.searchEmpty", { query })}</p>
        ) : (
          shown.map((code, index) => {
            const selected = code === value;
            const translatedName = t(`language.name.${code}`);
            const coverage = COVERAGE[code];
            return (
              <button
                key={code}
                ref={roving.ref(index)}
                type="button"
                className="lang-row"
                role="radio"
                aria-checked={selected}
                tabIndex={roving.tabIndex(index)}
                onClick={() => onChange(code)}
                onKeyDown={(event) => roving.onKeyDown(event, index)}
              >
                <span className="lang-name">
                  <b lang={code}>{NATIVE_NAMES[code]}</b>
                  {selected ? (
                    <span lang={code}>{sampleDate(code)}</span>
                  ) : translatedName === NATIVE_NAMES[code] ? null : (
                    <span>{translatedName}</span>
                  )}
                </span>
                <span className="lang-state">
                  {coverage === undefined || coverage >= 100
                    ? null
                    : t("language.coverage", { percent: coverage })}
                </span>
                <span className="lang-mark" aria-hidden="true">
                  <Icon name="tick" size={12} />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

interface ModelStateProps {
  state: ModelDownloadState;
  t: Translator;
  onRetry: () => void;
}

function ModelLine({
  icon,
  tone,
  title,
  detail,
  role = "status",
  children,
}: {
  icon: IconName;
  tone?: "ok" | "bad";
  title: string;
  detail?: string;
  role?: "status" | "alert";
  children?: ReactNode;
}) {
  return (
    <div className={tone ? `lang-model ${tone}` : "lang-model"} role={role}>
      <span className="lang-model-ico" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className="lang-model-txt">
        <b>{title}</b>
        {detail ? <span>{detail}</span> : null}
      </span>
      {children}
    </div>
  );
}

/** What the on-device translation model is doing, in one line. */
function ModelState({ state, t, onRetry }: ModelStateProps) {
  switch (state.status) {
    case "checking":
      return <ModelLine icon="refresh" title={t("language.model.checking")} />;
    case "ready":
      return (
        <ModelLine
          icon="tick"
          tone="ok"
          title={t("language.model.ready")}
          detail={t("language.translation.localNote")}
        />
      );
    case "not-downloaded":
      return (
        <ModelLine icon="download" title={t("language.model.preparing", { size: state.sizeMb })} />
      );
    case "downloading":
      return (
        <ModelLine icon="download" title={t("language.model.downloading")}>
          <span className="lang-progress">
            <progress max={100} value={state.progress} />
            <span>{state.progress}%</span>
          </span>
        </ModelLine>
      );
    case "unavailable":
      return (
        <ModelLine
          icon="warning"
          tone="bad"
          role="alert"
          title={t("language.model.unavailable")}
        />
      );
    case "error":
      return (
        <ModelLine icon="warning" tone="bad" role="alert" title={t("language.model.failed")}>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {t("language.model.retry")}
          </Button>
        </ModelLine>
      );
  }
}

/**
 * The language of the app, and the translation of what people write.
 *
 * Translation opens on what it does: a message read in your language with
 * the original kept above it, dimmed while translation is off. Its settings
 * follow it in one group, and the model's state is the group's last line.
 */
export function LanguagePane({
  locale,
  chatTranslationEnabled,
  chatAutoTranslateEnabled,
  chatTranslationTargetLanguage,
  update,
  t,
}: LanguagePaneProps) {
  const { state, download } = useModelStatus(
    chatTranslationTargetLanguage,
    chatTranslationEnabled,
  );

  // Turning translation on is the request to have the model: fetch it as soon
  // as the size is known instead of making the person press a second button.
  useEffect(() => {
    if (chatTranslationEnabled && state.status === "not-downloaded") void download();
  }, [chatTranslationEnabled, download, state.status]);

  const ready = state.status === "ready";

  return (
    <>
      <section className="sc" aria-label={t("language.interface.title")}>
        <header className="sc-h">{t("language.interface.title")}</header>
        <LanguageList
          label={t("language.interface.title")}
          value={locale}
          t={t}
          onChange={(next) => update({ locale: next })}
        />
        <p className="lang-foot">{t("language.interface.description")}</p>
      </section>

      <section className="sc" aria-label={t("language.translation.title")}>
        <header className="sc-h">{t("language.translation.title")}</header>
        <div className="sc-b lang-tr">
          <figure className={chatTranslationEnabled ? "lang-demo on" : "lang-demo"} aria-hidden="true">
            <span className="lang-demo-av">MK</span>
            <span className="lang-demo-body">
              <span className="lang-demo-head">
                <b>Marta</b>
                <time>19:04</time>
              </span>
              <span className="lang-demo-orig">{t("language.demo.original")}</span>
              <span className="lang-demo-tr">{t("language.demo.translated")}</span>
              <span className="lang-demo-meta">
                <Icon name="language" size={13} />
                {t("language.demo.from")}
              </span>
            </span>
          </figure>

          <div className="frm">
            <ToggleRow
              label={t("language.translation.enable")}
              detail={t("language.translation.enableDescription")}
              checked={chatTranslationEnabled}
              onChange={(enabled) => update({ chatTranslationEnabled: enabled })}
            />
            {chatTranslationEnabled ? (
              <>
                <div className="frm-row ap-row">
                  <span className="frm-lab">{t("language.translation.target")}</span>
                  <div className="frm-ctl ap-end">
                    <Segmented
                      options={SUPPORTED_LOCALES.map((code) => ({
                        value: code,
                        label: NATIVE_NAMES[code],
                      }))}
                      value={chatTranslationTargetLanguage}
                      onChange={(target: TranslationTargetLanguage) =>
                        update({ chatTranslationTargetLanguage: target })}
                      label={t("language.translation.targetLabel")}
                      variant="pill"
                      className="ap-seg"
                    />
                  </div>
                </div>
                <ToggleRow
                  label={t("language.translation.auto")}
                  detail={
                    ready
                      ? t("language.translation.autoDescription")
                      : t("language.translation.autoWaiting")
                  }
                  checked={chatAutoTranslateEnabled}
                  disabled={!ready}
                  onChange={(enabled) => update({ chatAutoTranslateEnabled: enabled })}
                />
                <div className="lang-model-row">
                  <ModelState state={state} t={t} onRetry={() => void download()} />
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
