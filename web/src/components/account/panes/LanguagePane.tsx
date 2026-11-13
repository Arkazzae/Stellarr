"use client";

import { useEffect } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { Switch } from "@/components/primitives/Switch";
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

interface LanguageChoicesProps {
  label: string;
  value: InterfaceLocale;
  t: Translator;
  onChange: (locale: InterfaceLocale) => void;
}

function LanguageChoices({ label, value, t, onChange }: LanguageChoicesProps) {
  return (
    <div className="lang-choices" role="radiogroup" aria-label={label}>
      {SUPPORTED_LOCALES.map((code) => {
        const selected = code === value;
        const translatedName = t(`language.name.${code}`);
        return (
          <button
            key={code}
            type="button"
            className={selected ? "lang-choice on" : "lang-choice"}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(code)}
          >
            <span className="lang-code" aria-hidden="true">{code.toUpperCase()}</span>
            <span className="lang-name">
              <b>{NATIVE_NAMES[code]}</b>
              {translatedName === NATIVE_NAMES[code] ? null : <span>{translatedName}</span>}
            </span>
            {selected ? <Icon name="tick" size={16} /> : null}
          </button>
        );
      })}
    </div>
  );
}

interface ModelStateProps {
  state: ModelDownloadState;
  t: Translator;
  onRetry: () => void;
}

/** What the on-device translation model is doing, in one line. */
function ModelState({ state, t, onRetry }: ModelStateProps) {
  switch (state.status) {
    case "checking":
      return (
        <span className="lang-model-state" role="status">
          {t("language.model.checking")}
        </span>
      );
    case "ready":
      return (
        <span className="lang-model-state ok" role="status">
          <Icon name="tick" size={14} />
          {t("language.model.ready")}
        </span>
      );
    case "not-downloaded":
      return (
        <span className="lang-model-state" role="status">
          {t("language.model.preparing", { size: state.sizeMb })}
        </span>
      );
    case "downloading":
      return (
        <div className="lang-model-download" role="status">
          <span>{t("language.model.downloading")}</span>
          <progress max={100} value={state.progress} />
          <b>{state.progress}%</b>
        </div>
      );
    case "unavailable":
      return (
        <span className="lang-model-state bad" role="alert">
          {t("language.model.unavailable")}
        </span>
      );
    case "error":
      return (
        <div className="lang-model-error" role="alert">
          <span>{t("language.model.failed")}</span>
          <Button type="button" variant="secondary" onClick={onRetry}>
            {t("language.model.retry")}
          </Button>
        </div>
      );
  }
}

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

  return (
    <>
      <section className="sc">
        <header className="sc-h">
          <span className="sc-ico" aria-hidden="true">
            <Icon name="language" size={17} />
          </span>
          {t("language.interface.title")}
        </header>
        <div className="sc-b lang-section">
          <p className="fld-note">{t("language.interface.description")}</p>
          <LanguageChoices
            label={t("language.interface.title")}
            value={locale}
            t={t}
            onChange={(next) => update({ locale: next })}
          />
        </div>
      </section>

      <section className="sc">
        <header className="sc-h">
          <span className="sc-ico" aria-hidden="true">
            <Icon name="sparkle" size={17} />
          </span>
          {t("language.translation.title")}
        </header>
        <div className="sc-b">
          <div className="frm">
            <ToggleRow
              label={t("language.translation.enable")}
              detail={t("language.translation.enableDescription")}
              checked={chatTranslationEnabled}
              onChange={(enabled) => update({ chatTranslationEnabled: enabled })}
            />
            {chatTranslationEnabled ? (
              <ToggleRow
                label={t("language.translation.auto")}
                detail={t("language.translation.autoDescription")}
                checked={chatAutoTranslateEnabled}
                disabled={state.status !== "ready"}
                onChange={(enabled) => update({ chatAutoTranslateEnabled: enabled })}
              />
            ) : null}
          </div>

          {chatTranslationEnabled ? (
            <div className="lang-target">
              <span className="fld-lab">{t("language.translation.target")}</span>
              <LanguageChoices
                label={t("language.translation.targetLabel")}
                value={chatTranslationTargetLanguage}
                t={t}
                onChange={(target: TranslationTargetLanguage) =>
                  update({ chatTranslationTargetLanguage: target })}
              />
              <div className="lang-model">
                <ModelState state={state} t={t} onRetry={() => void download()} />
              </div>
              <p className="set-note lang-private-note">{t("language.translation.localNote")}</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
