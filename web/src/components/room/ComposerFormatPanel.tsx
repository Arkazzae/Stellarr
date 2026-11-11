"use client";

import type { Ref } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import type { MessageKey, Translator } from "@/i18n";

const FORMATS: readonly {
  marker: string;
  icon: IconName;
  label: MessageKey;
  shortcut?: string;
}[] = [
  { marker: "**", icon: "bold", label: "composer.formatBold", shortcut: "Ctrl+B" },
  { marker: "*", icon: "italic", label: "composer.formatItalic", shortcut: "Ctrl+I" },
  { marker: "~~", icon: "strike", label: "composer.formatStrike" },
  { marker: "||", icon: "spoiler", label: "composer.formatSpoiler" },
  { marker: "`", icon: "inlineCode", label: "composer.formatCode" },
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
      {FORMATS.map(({ marker, icon, label, shortcut }) => (
        <button
          key={marker}
          type="button"
          className="fmt-btn"
          aria-label={t(label)}
          title={shortcut === undefined ? t(label) : `${t(label)} (${shortcut})`}
          onClick={() => onFormat(marker)}
        >
          <Icon name={icon} size={17} />
        </button>
      ))}
    </div>
  );
}
