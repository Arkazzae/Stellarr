"use client";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/primitives/Avatar";
import { formatShortDate } from "@/components/settings/panes/paneFormat";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { Ban } from "@/ports";
import { useLanguage } from "@/state/hooks";

export interface BansPaneProps {
  supported: boolean;
  bans: readonly Ban[];
  onUnban: (userId: string) => Promise<void>;
}

export function BansPane({ supported, bans, onUnban }: BansPaneProps) {
  const { locale, t } = useLanguage();
  const unban = useAsyncAction();

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.bansUnsupported")}</p>}
      <section className="sc">
        <header className="sc-h">
          <span className="sc-ico" aria-hidden="true">
            <Icon name="ban" size={17} />
          </span>
          {t("settings.bansList", { count: bans.length })}
        </header>
        <div className="sc-b">
          {unban.failed ? (
            <p className="set-note sound-error" role="alert">
              {t("settings.unbanFailed")}
            </p>
          ) : null}
          <div className="set-list">
            {bans.map((ban) => (
              <div className="set-item" key={ban.userId}>
                {/* Banned accounts are drained of hue, like anyone offline. */}
                <Avatar id={ban.userId} displayName={ban.displayName} size="md" offline />
                <span className="set-item-txt">
                  <b>{ban.displayName}</b>
                  <span>
                    {t("settings.bannedBy", {
                      name: ban.bannedByName,
                      reason: ban.reason,
                      date: formatShortDate(ban.bannedAt, locale),
                    })}
                  </span>
                </span>
                {/* This card is not a `SettingsSection`, so the action stays
                    hidden until the row is hovered; focus has to reveal it for
                    keyboard users. */}
                <button
                  type="button"
                  className="set-item-act"
                  disabled={!supported || unban.pending}
                  aria-label={t("settings.unban", { name: ban.displayName })}
                  onFocus={(event) => {
                    event.currentTarget.style.opacity = "1";
                  }}
                  onBlur={(event) => {
                    event.currentTarget.style.opacity = "";
                  }}
                  onClick={() => void unban.run(() => onUnban(ban.userId))}
                >
                  {t("settings.unban", { name: ban.displayName })}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
