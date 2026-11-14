"use client";

import { useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { InterfaceLocale, Translator } from "@/i18n";
import { inviteExpiry } from "@/lib/invites";
import type { Invite } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** "never expires", "expired", "expires in 6 days": counts in the coarsest unit that fits. */
function expiry(expiresAt: string | null, now: number, t: Translator, locale: InterfaceLocale): string {
  const left = inviteExpiry(expiresAt, now);
  if (left.state === "never") return t("settings.expiresNever");
  if (left.state === "expired") return t("settings.expired");
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" });
  return t("settings.expires", { time: relative.format(left.value, left.unit) });
}

export interface InvitesPaneProps {
  supported: boolean;
  invites: readonly Invite[];
  onCreate: () => Promise<void>;
  onRevoke: (inviteId: string) => Promise<void>;
}

export function InvitesPane({ supported, invites, onCreate, onRevoke }: InvitesPaneProps) {
  const { locale, t } = useLanguage();
  // One clock read per mount rather than per render, so every row's countdown
  // agrees with the others. The pane is remounted each time it is opened.
  const [now] = useState(() => Date.now());
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const change = useAsyncAction();

  const copyInvite = async (invite: Invite) => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopiedInviteId(invite.id);
    } catch {
      setCopiedInviteId(null);
    }
  };

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.unsupported")}</p>}
      <SettingsSection
        title={t("server.invites")}
        count={invites.length}
        countLabel={t("settings.invitesCount", { count: invites.length })}
        action={
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="asset-add"
            disabled={!supported || change.pending}
            onClick={() => void change.run(onCreate)}
          >
            <Icon name="plus" size={15} />
            {t("settings.newInvite")}
          </Button>
        }
      >
        {change.failed ? (
          <p className="set-note sound-error" role="alert">
            {t("settings.inviteActionFailed")}
          </p>
        ) : null}
        {invites.length === 0 ? (
          <div className="asset-empty">
            <Icon name="link" size={24} />
            <b>{t("settings.noInvites")}</b>
            <span>{t("settings.noInvitesDetail")}</span>
          </div>
        ) : (
          <div className="set-list">
            {invites.map((invite) => (
              <div className="set-item" key={invite.id}>
                <span className="set-item-txt mono">
                  <b>{invite.url}</b>
                  <span>
                    {`${invite.createdByName} · ${t("settings.inviteUsage", {
                      used: invite.uses,
                      max: invite.maxUses ?? "∞",
                    })} · ${expiry(invite.expiresAt, now, t, locale)}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="set-item-act"
                  aria-label={t("settings.copyInvite", { url: invite.url })}
                  onClick={() => void copyInvite(invite)}
                >
                  {copiedInviteId === invite.id ? t("invite.copied") : t("common.copy")}
                </button>
                <button
                  type="button"
                  className="set-item-act danger"
                  disabled={!supported || change.pending}
                  aria-label={t("settings.revokeInvite", { url: invite.url })}
                  onClick={() => void change.run(() => onRevoke(invite.id))}
                >
                  {t("settings.revoke")}
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
