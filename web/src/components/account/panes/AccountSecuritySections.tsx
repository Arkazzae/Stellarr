"use client";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";
import type { EnrollMode } from "@/components/auth/MfaEnrollStep";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { formatShortDate } from "@/components/settings/panes/paneFormat";
import type { MessageKey } from "@/i18n";
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
  /** Starts adding a method, on the way of proving it that was picked, or the app's. */
  onAddMethod(mode?: EnrollMode): void;
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

/** Below this many recovery codes the pane asks for new ones. */
const FEW_CODES = 3;

interface Way {
  mode: EnrollMode;
  icon: IconName;
  name: MessageKey;
  short: MessageKey;
  detail: MessageKey;
}

const WAYS: readonly Way[] = [
  {
    mode: "totp",
    icon: "mobile",
    name: "security.method.totp",
    short: "security.way.totpShort",
    detail: "security.way.totpDetail",
  },
  {
    mode: "email",
    icon: "mail",
    name: "security.way.email",
    short: "security.way.emailShort",
    detail: "security.way.emailDetail",
  },
  {
    mode: "passkey",
    icon: "key",
    name: "security.method.passkey",
    short: "security.method.passkey",
    detail: "security.way.passkeyDetail",
  },
];

const TYPE_NAME: Record<MfaMethod["type"], MessageKey> = {
  totp: "security.method.totp",
  email: "security.way.email",
  passkey: "security.method.passkey",
};

/**
 * The second step, which leads the sign-in pane because it is the one choice
 * there that changes what a stolen password is worth.
 *
 * Off, it says so in a sentence and offers the ways to prove it is you, each
 * starting its own setup, so the choice is made here rather than one dialog
 * later. On, it lists the methods that work, the recovery codes and the ways
 * not added yet. Every change asks for proof first; the container runs those
 * steps in a dialog.
 *
 * Where the account is open and what happened to it is a different errand and
 * has its own pane, `AccountActivitySections`, fed from the same props.
 */
export function TwoStepSection({
  security,
  loadError,
  actionError,
  busy,
  onAddMethod,
  onRemoveMethod,
  onRegenerateCodes,
  email,
}: AccountSecuritySectionsProps & {
  /** The account's address, where an emailed code goes; without one there is none to send. */
  email: string;
}) {
  const { t, locale } = useLanguage();
  const confirm = useConfirm();
  const date = (iso: string) => formatShortDate(iso, locale);

  const methodName = (method: MfaMethod) =>
    method.type === "email"
      ? t("security.method.email", { address: method.emailAddress ?? "" })
      : method.name || t(TYPE_NAME[method.type]);

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

  const header = <header className="sc-h">{t("security.twoStep.title")}</header>;

  if (loadError !== null || security === null) {
    return (
      <section className="sc">
        {header}
        <div className="sc-b">
          {loadError === null ? (
            <p className="sec-note">{t("common.loading")}</p>
          ) : (
            <p className="sec-note" role="alert">{loadError}</p>
          )}
        </div>
      </section>
    );
  }

  // Only the ways this server can check: mail for a code, an HTTPS address for
  // a passkey. A code by mail also needs an address to go to.
  const ways = WAYS.filter(
    (way) =>
      (way.mode !== "email" || (security.emailCodeAvailable && email.length > 0)) &&
      (way.mode !== "passkey" || security.passkeyAvailable),
  );
  // A method still waiting for its first code does not sign anyone in yet.
  const methods = security.methods.filter((method) => !method.pending);
  const error = actionError ? (
    <p className="sec-answer" data-tone="bad" role="alert">{actionError}</p>
  ) : null;

  if (methods.length === 0) {
    return (
      <section className="sc">
        {header}
        <div className="sc-b sec-card">
          <div className="sec-hero">
            <b>
              {t(security.mfaRequired ? "security.twoStep.requiredTitle" : "security.twoStep.offTitle")}
            </b>
            <span>
              {t(security.mfaRequired ? "security.twoStep.requiredLead" : "security.twoStep.offLead")}
            </span>
          </div>
          <div className="sec-ways">
            {ways.map((way) => (
              <button
                key={way.mode}
                type="button"
                className="sec-way"
                disabled={busy}
                onClick={() => onAddMethod(way.mode)}
              >
                <Icon name={way.icon} size={20} />
                {/* The space keeps the name and the sentence two words apart
                    for a screen reader; the column layout ignores it. */}
                <b>{t(way.name)}</b>{" "}
                <span>{t(way.detail, { address: email })}</span>
              </button>
            ))}
          </div>
          {error}
        </div>
      </section>
    );
  }

  const codes = security.remainingRecoveryCodes;
  const codesTone = codes === 0 ? "bad" : codes <= FEW_CODES ? "warn" : undefined;
  const codesLine =
    codes === 0
      ? t("security.codes.none")
      : codes <= FEW_CODES
        ? t("security.codes.few", { count: codes })
        : t("security.codes.left", { count: codes });

  return (
    <section className="sc">
      {header}
      <div className="sc-b sec-card">
        <div className="sec-hero">
          <b>{t("security.twoStep.onTitle")}</b>
          <span>{t("security.twoStep.onLead")}</span>
        </div>
        <div className="sec-list">
          {methods.map((method) => {
            const used =
              method.lastUsedAt === undefined
                ? t("security.method.added", { added: date(method.createdAt) })
                : t("security.method.addedUsed", {
                    added: date(method.createdAt),
                    used: date(method.lastUsedAt),
                  });
            // A named method says what kind it is; an unnamed one is named by its kind.
            const kind = method.type !== "email" && method.name ? `${t(TYPE_NAME[method.type])} · ` : "";
            return (
              <div className="sec-row" key={method.id}>
                <span className="sec-copy">
                  <b>{methodName(method)}</b>
                  <small>{kind + used}</small>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={t("security.method.removeNamed", { name: methodName(method) })}
                  onClick={() => void removeMethod(method)}
                  disabled={busy}
                >
                  {t("security.method.remove")}
                </Button>
              </div>
            );
          })}
          <div className="sec-row">
            <span className="sec-copy">
              <b>{t("security.codes.title")}</b>
              <small data-tone={codesTone}>{codesLine}</small>
            </span>
            <Button
              type="button"
              variant={codesTone === undefined ? "secondary" : "primary"}
              size="sm"
              onClick={() => void regenerate()}
              disabled={busy}
            >
              {t("security.codes.regenerate")}
            </Button>
          </div>
          <div className="sec-add">
            <span>{t("security.twoStep.addAnother")}</span>
            {ways.map((way) => (
              <Button
                key={way.mode}
                type="button"
                variant="secondary"
                size="sm"
                aria-label={t("security.twoStep.addWay", { way: t(way.name) })}
                onClick={() => onAddMethod(way.mode)}
                disabled={busy}
              >
                <Icon name={way.icon} size={15} />
                {t(way.short)}
              </Button>
            ))}
          </div>
        </div>
        {error}
      </div>
    </section>
  );
}

/**
 * The providers that can sign the account in, each on one line with the one
 * thing to do about it. Shown only on an instance that has providers.
 */
export function IdentitiesSection({
  security,
  busy,
  onLinkIdentity,
  onUnlinkIdentity,
}: AccountSecuritySectionsProps) {
  const { t, locale } = useLanguage();
  const confirm = useConfirm();

  if (security === null || (security.identityProviders.length === 0 && security.identities.length === 0)) {
    return null;
  }

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

  const unlinked = security.identityProviders.filter(
    (provider) => !security.identities.some((identity) => identity.providerId === provider.id),
  );

  return (
    <section className="sc">
      <header className="sc-h">{t("security.identities.title")}</header>
      <div className="sc-b sec-list">
        {security.identities.map((identity) => (
          <div className="sec-row" key={identity.id}>
            <span className="sec-copy">
              <b>{identity.name}</b>
              <small>
                {t("security.identities.linked", { date: formatShortDate(identity.createdAt, locale) })}
              </small>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t("security.identities.unlinkNamed", { name: identity.name })}
              onClick={() => void unlinkIdentity(identity)}
              disabled={busy}
            >
              {t("security.identities.unlink")}
            </Button>
          </div>
        ))}
        {unlinked.map((provider) => (
          <div className="sec-row" key={provider.id}>
            <span className="sec-copy">
              <b>{provider.displayName}</b>
              <small>{t("security.identities.notLinked")}</small>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t("security.identities.link", { provider: provider.displayName })}
              onClick={() => onLinkIdentity(provider)}
              disabled={busy}
            >
              {t("security.identities.connect")}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
