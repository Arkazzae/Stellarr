import { useState, type FormEvent, type ReactNode } from "react";

import { Spinner } from "@/components/spinner";
import { AppShell } from "@/components/app-shell";
import { BrandMark } from "@/components/brand-mark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { CockpitApiError } from "@/lib/api";
import { WEB_CONFIRM_URL } from "@/lib/web-sign-in";
import { useCockpit } from "@/state/cockpit-context";

function CenteredState({ children }: { children: ReactNode }) {
  return <main className="grid min-h-svh place-items-center bg-muted/30 p-4">{children}</main>;
}

function loginFailureMessage(cause: unknown): string {
  if (cause instanceof CockpitApiError && cause.status === 429) {
    return t("gate.tooManyAttempts");
  }
  return cause instanceof Error ? cause.message : t("gate.loginFailed");
}

function LoginScreen() {
  const { login } = useCockpit();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password, keepSignedIn);
      // Success replaces this screen, so the button stays disabled until it goes.
    } catch (cause) {
      setError(loginFailureMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <CenteredState>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandMark className="mb-3 size-8" />
          <CardTitle>{t("gate.login.title")}</CardTitle>
          <CardDescription>{t("gate.login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="cockpit-username">{t("gate.login.username")}</Label>
              <Input
                id="cockpit-username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cockpit-password">{t("gate.login.password")}</Label>
              <Input
                id="cockpit-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(event) => setKeepSignedIn(event.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              {t("gate.login.keepSignedIn")}
            </label>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Spinner /> : null}
              {submitting ? t("gate.login.submitting") : t("gate.login.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </CenteredState>
  );
}

export function AppGate() {
  const { phase, error, reload, logout } = useCockpit();

  switch (phase) {
    case "ready":
      return <AppShell />;
    case "anonymous":
      return <LoginScreen />;
    case "loading":
      return (
        <CenteredState>
          <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {t("gate.checking")}
          </div>
        </CenteredState>
      );
    case "forbidden":
      return (
        <CenteredState>
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{t("gate.forbidden.title")}</CardTitle>
              <CardDescription>{t("gate.forbidden.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => void logout()}>
                {t("gate.forbidden.logout")}
              </Button>
            </CardContent>
          </Card>
        </CenteredState>
      );
    case "mfa-required":
      return (
        <CenteredState>
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{t("gate.mfa.title")}</CardTitle>
              <CardDescription>{t("gate.mfa.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* A plain link: the sign-in page is the web client's, outside this app's router. */}
              <Button asChild>
                <a href={WEB_CONFIRM_URL}>{t("gate.mfa.confirm")}</a>
              </Button>
            </CardContent>
          </Card>
        </CenteredState>
      );
    case "error":
      return (
        <CenteredState>
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{t("gate.error.title")}</CardTitle>
              <CardDescription>{error ?? t("gate.error.fallback")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void reload()}>{t("gate.error.retry")}</Button>
            </CardContent>
          </Card>
        </CenteredState>
      );
  }
}
