import { useCallback, useEffect, useId, useState, type FormEvent } from "react";

import { Spinner } from "@/components/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { t, type MessageKey } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { cockpitApi, type CockpitRecovery, type CockpitUser, type CockpitUserSecurity } from "@/lib/api";

interface UserSecuritySheetProps {
  user: CockpitUser;
  open: boolean;
  onOpenChange(open: boolean): void;
}

const METHOD_LABEL: Record<string, MessageKey> = {
  totp: "userSecurity.method.totp",
  email: "userSecurity.method.email",
  passkey: "userSecurity.method.passkey",
};

const EVENT_LABEL: Record<string, MessageKey> = {
  "login-succeeded": "userSecurity.event.login-succeeded",
  "login-failed": "userSecurity.event.login-failed",
  "mfa-succeeded": "userSecurity.event.mfa-succeeded",
  "mfa-failed": "userSecurity.event.mfa-failed",
  "method-added": "userSecurity.event.method-added",
  "method-removed": "userSecurity.event.method-removed",
  "recovery-code-used": "userSecurity.event.recovery-code-used",
  "password-changed": "userSecurity.event.password-changed",
  "email-changed": "userSecurity.event.email-changed",
  "session-revoked": "userSecurity.event.session-revoked",
  "cli-recovery": "userSecurity.event.cli-recovery",
  "identity-linked": "userSecurity.event.identity-linked",
  "identity-unlinked": "userSecurity.event.identity-unlinked",
};

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : t("accountActions.failed"));

/**
 * One account's security for the instance owner: what protects it, which
 * provider accounts sign in to it and what happened lately, without a single
 * secret. From here the owner recovers an account that lost its second step,
 * as `stellarr security recover` does, and hands the code on once.
 */
export function UserSecuritySheet({ user, open, onOpenChange }: UserSecuritySheetProps) {
  const reasonId = useId();
  const [security, setSecurity] = useState<CockpitUserSecurity | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [recovery, setRecovery] = useState<CockpitRecovery | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    cockpitApi.userSecurity(user.id).then(
      (next) => {
        if (!active) return;
        setSecurity(next);
        setLoadError(null);
      },
      (cause: unknown) => active && setLoadError(errorText(cause)),
    );
    return () => {
      active = false;
    };
  }, [open, user.id]);

  /** Reads the state again after a change made here. */
  const load = useCallback(async () => setSecurity(await cockpitApi.userSecurity(user.id)), [user.id]);

  const close = (next: boolean) => {
    if (!next) {
      // The code is shown once; closing the sheet forgets it.
      setRecovery(null);
      setReason("");
      setNotice(null);
      setActionError(null);
      setCopied(false);
    }
    onOpenChange(next);
  };

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setActionError(errorText(cause));
    } finally {
      setPending(false);
    }
  };

  const recover = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      setRecovery(await cockpitApi.recoverUser(user.id, reason.trim()));
      setReason("");
    });
  };

  const copy = async () => {
    if (recovery === null) return;
    try {
      await navigator.clipboard.writeText(recovery.credential);
      setCopied(true);
    } catch {
      // The code is selectable on screen, so a refused clipboard costs nothing.
    }
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("userSecurity.title", { name: user.displayName })}</SheetTitle>
          <SheetDescription>{t("userSecurity.description")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6 text-sm">
          {loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : security === null ? (
            <p role="status" className="text-muted-foreground">{t("userSecurity.loading")}</p>
          ) : (
            <>
              {security.recoveryRequired ? (
                <Alert>
                  <AlertDescription>{t("userSecurity.recoveryRequired")}</AlertDescription>
                </Alert>
              ) : null}

              <section className="space-y-2">
                <h3 className="font-medium">{t("userSecurity.methods")}</h3>
                {security.methods.length === 0 ? (
                  <p className="text-muted-foreground">{t("userSecurity.noMethods")}</p>
                ) : (
                  <ul className="space-y-2">
                    {security.methods.map((method) => (
                      <li key={method.id}>
                        <span className="block font-medium">{method.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {METHOD_LABEL[method.type] ? t(METHOD_LABEL[method.type]!) : method.type}
                          {", "}
                          {!method.confirmed
                            ? t("userSecurity.pending")
                            : method.lastUsedAt
                              ? t("userSecurity.lastUsed", { date: formatDateTime(method.lastUsedAt) })
                              : t("userSecurity.neverUsed")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-muted-foreground">
                  {t("userSecurity.codes", { count: security.remainingRecoveryCodes })}
                  <br />
                  {t("userSecurity.devices", { count: security.trustedDevices })}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">{t("userSecurity.identities")}</h3>
                {security.identities.length === 0 ? (
                  <p className="text-muted-foreground">{t("userSecurity.noIdentities")}</p>
                ) : (
                  <ul className="space-y-2">
                    {security.identities.map((identity) => (
                      <li key={identity.id} className="flex items-center justify-between gap-3">
                        <span>
                          <span className="font-medium">{identity.name}</span>
                          <span className="block text-xs text-muted-foreground">{identity.issuer}</span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            void run(async () => {
                              await cockpitApi.unlinkUserIdentity(user.id, identity.id);
                              setNotice(t("userSecurity.unlinked"));
                            })
                          }
                        >
                          {t("userSecurity.unlink")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="font-medium">{t("userSecurity.events")}</h3>
                {security.events.length === 0 ? (
                  <p className="text-muted-foreground">{t("userSecurity.noEvents")}</p>
                ) : (
                  <ul className="space-y-1 text-muted-foreground">
                    {security.events.map((event) => (
                      <li key={`${event.kind}-${event.createdAt}`}>
                        {EVENT_LABEL[event.kind] ? t(EVENT_LABEL[event.kind]!) : event.kind}
                        {" · "}
                        {formatDateTime(event.createdAt)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {recovery !== null ? (
            <section className="space-y-2 rounded-2xl border border-border/70 bg-card p-4">
              <h3 className="font-medium">{t("userSecurity.credential")}</h3>
              <code className="block break-all rounded-xl bg-background px-3 py-2 font-mono text-xs">{recovery.credential}</code>
              <p className="text-muted-foreground">
                {t("userSecurity.credentialDetail", { date: formatDateTime(recovery.expiresAt) })}
                <br />
                {t("userSecurity.revoked", {
                  methods: recovery.methodsRevoked,
                  devices: recovery.trustedDevicesRevoked,
                  sessions: recovery.sessionsRevoked,
                })}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                {copied ? t("userSecurity.copied") : t("userSecurity.copy")}
              </Button>
            </section>
          ) : (
            <form className="space-y-2 rounded-2xl border border-border/70 bg-card p-4" onSubmit={recover}>
              <h3 className="font-medium">{t("userSecurity.recover")}</h3>
              <p className="text-muted-foreground">{t("userSecurity.recoverDetail")}</p>
              <Label htmlFor={reasonId}>{t("userSecurity.reason")}</Label>
              <Input
                id={reasonId}
                value={reason}
                minLength={3}
                maxLength={500}
                required
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("userSecurity.reasonHint")}</p>
              <Button type="submit" variant="destructive" disabled={pending || reason.trim().length < 3}>
                {pending ? <Spinner /> : null}
                {pending ? t("userSecurity.recovering") : t("userSecurity.recover")}
              </Button>
            </form>
          )}

          {notice ? (
            <p role="status" className="text-muted-foreground">{notice}</p>
          ) : null}
          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
