"use client";

import { Icon } from "@/components/icons/Icon";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { formatShortDate } from "@/components/settings/panes/paneFormat";
import type { MessageKey } from "@/i18n";
import { describeUserAgent } from "@/lib/userAgent";
import type { AccountSecurity, MfaMethod, OwnSession, SecurityEvent, TrustedDevice } from "@/ports";
import { useLanguage } from "@/state/hooks";

export interface AccountSecuritySectionsProps {
  /** Null while the first answer is on its way. */
  security: AccountSecurity | null;
  loadError: string | null;
  actionError: string | null;
  busy: boolean;
  onAddMethod(): void;
  onRemoveMethod(method: MfaMethod): void;
  onRegenerateCodes(): void;
  onRevokeDevice(device: TrustedDevice): void;
  /** The account's signed-in devices; null while loading. */
  sessions: OwnSession[] | null;
  onRevokeSession(session: OwnSession): void;
  onRevokeOtherSessions(): void;
}

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
  "desktop-approved": "security.event.desktopApproved",
};

/**
 * The second factor, the devices that may skip it and what happened to the
 * account, under the login details of the security pane. Every change here
 * asks for proof first; the container runs those steps in a dialog.
 */
export function AccountSecuritySections({
  security,
  loadError,
  actionError,
  busy,
  onAddMethod,
  onRemoveMethod,
  onRegenerateCodes,
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

  const methodName = (method: MfaMethod) =>
    method.type === "email"
      ? t("security.method.email", { address: method.emailAddress ?? "" })
      : method.name || t(method.type === "passkey" ? "security.method.passkey" : "security.method.totp");

  const removeMethod = async (method: MfaMethod) => {
    const confirmed = await confirm({
      title: t("security.method.removeTitle", { name: methodName(method) }),
      description: t("security.method.removeDetail"),
      confirmLabel: t("security.method.remove"),
      danger: true,
      icon: "trash",
    });
    if (confirmed) onRemoveMethod(method);
  };

  const regenerate = async () => {
    const confirmed = await confirm({
      title: t("security.codes.regenerateTitle"),
      description: t("security.codes.regenerateDetail"),
      confirmLabel: t("security.codes.regenerate"),
    });
    if (confirmed) onRegenerateCodes();
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

  const methods = security?.methods.filter((method) => !method.pending) ?? [];

  return (
    <>
      <section className="sc acc-security">
        <header className="sc-h">
          <span className="sc-ico" aria-hidden="true">
            <Icon name="shield" size={17} />
          </span>
          {t("security.twoStep.title")}
        </header>
        <div className="sc-b acc-security-list">
          {loadError ? (
            <p className="set-note" role="alert">
              {loadError}
            </p>
          ) : security === null ? null : (
            <>
              {methods.length === 0 ? (
                <div className="acc-security-item">
                  <div className="acc-security-summary">
                    <span className="acc-security-copy">
                      <span className="empty">{t("security.twoStep.off")}</span>
                      <small>
                        {security.mfaRequired
                          ? t("security.twoStep.required")
                          : t("security.twoStep.offDetail")}
                      </small>
                    </span>
                    <button type="button" className="btn-ghost sm" onClick={onAddMethod} disabled={busy}>
                      {t("security.twoStep.turnOn")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {methods.map((method) => (
                    <div className="acc-security-item" key={method.id}>
                      <div className="acc-security-summary">
                        <span className="acc-security-copy">
                          <b>{methodName(method)}</b>
                          <small>
                            {method.lastUsedAt === undefined
                              ? t("security.method.added", { added: date(method.createdAt) })
                              : t("security.method.addedUsed", {
                                  added: date(method.createdAt),
                                  used: date(method.lastUsedAt),
                                })}
                          </small>
                        </span>
                        <button
                          type="button"
                          className="btn-ghost sm"
                          onClick={() => void removeMethod(method)}
                          disabled={busy}
                        >
                          {t("security.method.remove")}
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="acc-security-item">
                    <div className="acc-security-summary">
                      <span className="acc-security-copy">
                        <b>{t("security.codes.title")}</b>
                        <span>{t("security.codes.remaining", { count: security.remainingRecoveryCodes })}</span>
                        <small>{t("security.codes.detail")}</small>
                      </span>
                      <button
                        type="button"
                        className="btn-ghost sm"
                        onClick={() => void regenerate()}
                        disabled={busy}
                      >
                        {t("security.codes.regenerate")}
                      </button>
                    </div>
                  </div>
                  <div className="acc-security-item">
                    <button type="button" className="btn-ghost sm" onClick={onAddMethod} disabled={busy}>
                      {t("security.twoStep.add")}
                    </button>
                  </div>
                </>
              )}
              {actionError ? (
                <p className="acc-answer bad" role="alert">
                  {actionError}
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>

      {security !== null && (security.trustedDevices.length > 0 || methods.length > 0) ? (
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
                    <button
                      type="button"
                      className="btn-ghost sm"
                      onClick={() => onRevokeDevice(device)}
                      disabled={busy}
                    >
                      {t("security.devices.revoke")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
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
                    <button
                      type="button"
                      className="btn-ghost sm"
                      onClick={() => onRevokeSession(session)}
                      disabled={busy}
                    >
                      {t("security.sessions.signOut")}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sessions.some((session) => !session.current) ? (
              <div className="acc-security-item">
                <button
                  type="button"
                  className="btn-ghost sm"
                  onClick={() => void signOutOthers()}
                  disabled={busy}
                >
                  {t("security.sessions.signOutOthers")}
                </button>
              </div>
            ) : null}
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
