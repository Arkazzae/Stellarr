"use client";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { formatShortDate } from "@/components/settings/panes/paneFormat";
import type { MessageKey } from "@/i18n";
import { describeUserAgent } from "@/lib/userAgent";
import type { SecurityEvent } from "@/ports";
import { useLanguage } from "@/state/hooks";

import type { AccountSecuritySectionsProps } from "./AccountSecuritySections";

const EVENT_LABEL: Record<string, MessageKey> = {
  "login-succeeded": "security.event.loginSucceeded",
  "login-failed": "security.event.loginFailed",
  "mfa-succeeded": "security.event.mfaSucceeded",
  "mfa-failed": "security.event.mfaFailed",
  "method-added": "security.event.methodAdded",
  "method-removed": "security.event.methodRemoved",
  "recovery-codes-regenerated": "security.event.recoveryCodesRegenerated",
  "recovery-code-used": "security.event.recoveryCodeUsed",
  "trusted-device-added": "security.event.trustedDeviceAdded",
  "trusted-device-removed": "security.event.trustedDeviceRemoved",
  "session-revoked": "security.event.sessionRevoked",
  "password-changed": "security.event.passwordChanged",
  "cli-recovery": "security.event.cliRecovery",
  "policy-changed": "security.event.policyChanged",
  "identity-linked": "security.event.identityLinked",
  "identity-unlinked": "security.event.identityUnlinked",
  "email-changed": "security.event.emailChanged",
  "desktop-approved": "security.event.desktopApproved",
};

/**
 * Where the account is open and what happened to it: the pane someone opens
 * when something looks wrong, so the sessions come first and the way to end
 * them is one click away.
 *
 * It reads the same state as the sign-in sections, because one request loads
 * both, and a failed load or action is reported here as well as there.
 */
export function AccountActivitySections({
  security,
  loadError,
  actionError,
  busy,
  onRevokeDevice,
  sessions,
  onRevokeSession,
  onRevokeOtherSessions,
}: AccountSecuritySectionsProps) {
  const { t, locale } = useLanguage();
  const confirm = useConfirm();
  const date = (iso: string) => formatShortDate(iso, locale);

  const deviceLabel = (agent: string) => {
    const { browser, system } = describeUserAgent(agent);
    if (browser !== undefined && system !== undefined) {
      return t("security.device.browserOn", { browser, system });
    }
    return browser ?? system ?? (agent.trim().slice(0, 60) || t("security.device.unknown"));
  };

  const signOutOthers = async () => {
    const confirmed = await confirm({
      title: t("security.sessions.signOutOthersTitle"),
      description: t("security.sessions.signOutOthersDetail"),
      confirmLabel: t("security.sessions.signOutOthers"),
      danger: true,
      icon: "signout",
    });
    if (confirmed) onRevokeOtherSessions();
  };

  const eventLabel = (event: SecurityEvent) => {
    const key = EVENT_LABEL[event.kind];
    return key === undefined ? t("security.event.other", { kind: event.kind }) : t(key);
  };

  // Trusted devices only mean something once there is a second step to skip.
  const hasSecondStep = security?.methods.some((method) => !method.pending) ?? false;

  return (
    <>
      {loadError ? (
        <p className="set-note" role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className="acc-answer bad" role="alert">
          {actionError}
        </p>
      ) : null}

      {sessions !== null && sessions.length > 0 ? (
        <section className="sc acc-security">
          <header className="sc-h">
            <span className="sc-ico" aria-hidden="true">
              <Icon name="server" size={17} />
            </span>
            {t("security.sessions.title")}
          </header>
          <div className="sc-b acc-security-list">
            {sessions.map((session) => (
              <div className="acc-security-item" key={session.id}>
                <div className="acc-security-summary">
                  <span className="acc-security-copy">
                    <b>{deviceLabel(session.device)}</b>
                    <small>
                      {session.current
                        ? t("security.sessions.current", { ip: session.ipAddress })
                        : t("security.sessions.lastSeen", {
                            date: date(session.lastSeenAt),
                            ip: session.ipAddress,
                          })}
                    </small>
                  </span>
                  {session.current ? null : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onRevokeSession(session)}
                      disabled={busy}
                    >
                      {t("security.sessions.signOut")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {sessions.some((session) => !session.current) ? (
              <div className="acc-security-item">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void signOutOthers()}
                  disabled={busy}
                >
                  {t("security.sessions.signOutOthers")}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {security !== null && (security.trustedDevices.length > 0 || hasSecondStep) ? (
        <section className="sc acc-security">
          <header className="sc-h">
            <span className="sc-ico" aria-hidden="true">
              <Icon name="mobile" size={17} />
            </span>
            {t("security.devices.title")}
          </header>
          <div className="sc-b acc-security-list">
            {security.trustedDevices.length === 0 ? (
              <p className="acc-security-item acc-security-empty">{t("security.devices.empty")}</p>
            ) : (
              security.trustedDevices.map((device) => (
                <div className="acc-security-item" key={device.id}>
                  <div className="acc-security-summary">
                    <span className="acc-security-copy">
                      <b>{deviceLabel(device.device)}</b>
                      <small>{t("security.devices.until", { date: date(device.expiresAt) })}</small>
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onRevokeDevice(device)}
                      disabled={busy}
                    >
                      {t("security.devices.revoke")}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {security !== null ? (
        <section className="sc acc-security">
          <header className="sc-h">
            <span className="sc-ico" aria-hidden="true">
              <Icon name="list" size={17} />
            </span>
            {t("security.history.title")}
          </header>
          <div className="sc-b acc-security-list">
            {security.recentEvents.length === 0 ? (
              <p className="acc-security-item acc-security-empty">{t("security.history.empty")}</p>
            ) : (
              <ol className="acc-security-history">
                {security.recentEvents.map((event) => (
                  <li key={event.id}>
                    <span>{eventLabel(event)}</span>
                    <small>
                      {date(event.createdAt)},{" "}
                      {t("security.history.where", {
                        device: deviceLabel(event.device),
                        ip: event.ipAddress,
                      })}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
