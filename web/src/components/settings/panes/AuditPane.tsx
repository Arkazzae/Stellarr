"use client";

import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { formatShortDate } from "@/components/settings/panes/paneFormat";
import type { InterfaceLocale, Translator } from "@/i18n";
import { formatTime, isSameDay } from "@/lib/format";
import type { AuditEntry } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** "dzisiaj 18:40", "wczoraj 22:15", then the plain date. */
function when(iso: string, now: Date, t: Translator, locale: InterfaceLocale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (isSameDay(at, now)) return t("settings.today", { time: formatTime(iso, locale) });

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(at, yesterday)) return t("settings.yesterday", { time: formatTime(iso, locale) });

  return formatShortDate(iso, locale);
}

export interface AuditPaneProps {
  supported: boolean;
  entries: readonly AuditEntry[];
}

export function AuditPane({ supported, entries }: AuditPaneProps) {
  const { locale, t } = useLanguage();
  // Read once per mount so every row agrees on what "today" is.
  const [now] = useState(() => new Date());

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.auditUnsupported")}</p>}
      <section className="sc">
        <header className="sc-h">
          <span className="sc-ico" aria-hidden="true">
            <Icon name="clipboard" size={17} />
          </span>
          {t("settings.auditPeriod")}
        </header>
        <div className="sc-b">
          <div className="set-list">
            {entries.map((entry) => (
              <div className="set-item" key={entry.id}>
                <span className="set-item-txt">
                  <b>{entry.summary}</b>
                  <span>{when(entry.at, now, t, locale)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
