"use client";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { formatShortDate } from "@/components/settings/panes/paneFormat";
import type {
  AccountSecurity,
  IdentityProvider,
  LinkedIdentity,
  MfaMethod,
  OwnSession,
  TrustedDevice,
} from "@/ports";
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
  /** Leaves for the provider, after a fresh proof, to link the account to it. */
  onLinkIdentity(provider: IdentityProvider): void;
  onUnlinkIdentity(identity: LinkedIdentity): void;
}

/**
 * The second factor and the providers that can sign the account in, under the
 * login details of the security pane. Every change here asks for proof first;
 * the container runs those steps in a dialog.
 *
 * Where the account is open and what happened to it is a different errand and
 * has its own pane, `AccountActivitySections`, fed from the same props.
 */
export function AccountSecuritySections({
  security,
  loadError,
  actionError,
  busy,
  onAddMethod,
  onRemoveMethod,
  onRegenerateCodes,
  onLinkIdentity,
  onUnlinkIdentity,
}: AccountSecuritySectionsProps) {
  const { t, locale } = useLanguage();
  const confirm = useConfirm();
  const date = (iso: string) => formatShortDate(iso, locale);

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

  const unlinkIdentity = async (identity: LinkedIdentity) => {
    const confirmed = await confirm({
      title: t("security.identities.unlinkTitle", { name: identity.name }),
      description: t("security.identities.unlinkDetail"),
      confirmLabel: t("security.identities.unlink"),
      danger: true,
      icon: "link",
    });
    if (confirmed) onUnlinkIdentity(identity);
  };

  const regenerate = async () => {
    const confirmed = await confirm({
      title: t("security.codes.regenerateTitle"),
      description: t("security.codes.regenerateDetail"),
      confirmLabel: t("security.codes.regenerate"),
    });
    if (confirmed) onRegenerateCodes();
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onAddMethod}
                      disabled={busy}
                    >
                      {t("security.twoStep.turnOn")}
                    </Button>
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
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void removeMethod(method)}
                          disabled={busy}
                        >
                          {t("security.method.remove")}
                        </Button>
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
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void regenerate()}
                        disabled={busy}
                      >
                        {t("security.codes.regenerate")}
                      </Button>
                    </div>
                  </div>
                  <div className="acc-security-item">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onAddMethod}
                      disabled={busy}
                    >
                      {t("security.twoStep.add")}
                    </Button>
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

      {security !== null && (security.identityProviders.length > 0 || security.identities.length > 0) ? (
        <section className="sc acc-security">
          <header className="sc-h">
            <span className="sc-ico" aria-hidden="true">
              <Icon name="link" size={17} />
            </span>
            {t("security.identities.title")}
          </header>
          <div className="sc-b acc-security-list">
            {security.identities.length === 0 ? (
              <p className="acc-security-item acc-security-empty">{t("security.identities.empty")}</p>
            ) : (
              security.identities.map((identity) => (
                <div className="acc-security-item" key={identity.id}>
                  <div className="acc-security-summary">
                    <span className="acc-security-copy">
                      <b>{identity.name}</b>
                      <small>{t("security.identities.linked", { date: date(identity.createdAt) })}</small>
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void unlinkIdentity(identity)}
                      disabled={busy}
                    >
                      {t("security.identities.unlink")}
                    </Button>
                  </div>
                </div>
              ))
            )}
            {security.identityProviders
              .filter((provider) => !security.identities.some((identity) => identity.providerId === provider.id))
              .map((provider) => (
                <div className="acc-security-item" key={provider.id}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onLinkIdentity(provider)}
                    disabled={busy}
                  >
                    {t("security.identities.link", { provider: provider.displayName })}
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ) : null}

    </>
  );
}
