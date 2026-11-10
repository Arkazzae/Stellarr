"use client";

import type { Ref } from "react";

import type { MessageKey, Translator } from "@/i18n";

const FORMATS: readonly {
  marker: string;
  glyph: string;
  className: string;
  label: MessageKey;
  shortcut?: string;
}[] = [
  { marker: "**", glyph: "B", className: "bold", label: "composer.formatBold", shortcut: "Ctrl+B" },
  { marker: "*", glyph: "I", className: "italic", label: "composer.formatItalic", shortcut: "Ctrl+I" },
  { marker: "~~", glyph: "S", className: "strike", label: "composer.formatStrike" },
  { marker: "||", glyph: "▒", className: "spoiler", label: "composer.formatSpoiler" },
  { marker: "`", glyph: "</>", className: "code", label: "composer.formatCode" },
];

export interface ComposerFormatPanelProps {
  panelRef: Ref<HTMLDivElement>;
  onFormat(marker: string): void;
  t: Translator;
}

/** The popover behind the formatting button: one button per Markdown marker. */
export function ComposerFormatPanel({ panelRef, onFormat, t }: ComposerFormatPanelProps) {
  return (
    <div className="fmt-pop" ref={panelRef} role="toolbar" aria-label={t("composer.format")}>
      {FORMATS.map(({ marker, glyph, className, label, shortcut }) => (
        <button
          key={marker}
          type="button"
          className={`fmt-btn ${className}`}
          aria-label={t(label)}
          title={shortcut === undefined ? t(label) : `${t(label)} (${shortcut})`}
          onClick={() => onFormat(marker)}
        >
          {glyph}
        </button>
      ))}
    </div>
  );
}
