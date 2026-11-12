"use client";

import { Icon } from "@stellarr/ui/icons";
import type { Translator } from "@/i18n";

import { CODE_LANGUAGES, type CodeLanguageId } from "./codeLanguages";

export interface ComposerReplyBarProps {
  authorName: string;
  preview: string;
  onCancel?(): void;
  t: Translator;
}

/** Names whose message is being answered. Sending consumes it; the host clears it. */
export function ComposerReplyBar({ authorName, preview, onCancel, t }: ComposerReplyBarProps) {
  return (
    <div className="comp-reply">
      <span className="comp-reply-txt">
        {t("composer.replyingTo")} <b>{authorName}</b>
        {preview.length === 0 ? null : <i>{preview}</i>}
      </span>
      <button
        type="button"
        className="comp-reply-x"
        aria-label={t("composer.cancelReply")}
        title={t("composer.cancelReply")}
        onClick={onCancel}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export interface ComposerCodeBarProps {
  language: CodeLanguageId;
  onLanguageChange(language: CodeLanguageId): void;
  onDisable(): void;
  t: Translator;
}

/** Shown above the field while the draft will be sent as a fenced code block. */
export function ComposerCodeBar({ language, onLanguageChange, onDisable, t }: ComposerCodeBarProps) {
  return (
    <div className="comp-code-bar" role="status">
      <Icon name="code" size={16} />
      <span>{t("composer.codeMessage")}</span>
      <label>
        <span>{t("composer.language")}</span>
        <select
          aria-label={t("composer.codeLanguage")}
          value={language}
          onChange={(event) => onLanguageChange(event.target.value as CodeLanguageId)}
        >
          {CODE_LANGUAGES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id === "plaintext" ? t("code.plaintext") : entry.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label={t("composer.disableCode")}
        title={t("composer.disableCode")}
        onClick={onDisable}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
