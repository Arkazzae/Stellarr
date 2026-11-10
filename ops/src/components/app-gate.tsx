import { LoaderCircle, LockKeyhole, ServerCrash, ShieldX } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { OpsApiError } from "@/lib/api";
import { useOps } from "@/state/ops-context";

function CenteredState({ children }: { children: ReactNode }) {
  return <main className="grid min-h-svh place-items-center bg-muted/30 p-4">{children}</main>;
}

function loginFailureMessage(cause: unknown): string {
  if (cause instanceof OpsApiError && cause.status === 429) {
    return t("gate.tooManyAttempts");
  }
  return cause instanceof Error ? cause.message : t("gate.loginFailed");
}

function LoginScreen() {
  const { login } = useOps();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      // Success replaces this screen, so the button stays disabled until it goes.
    } catch (cause) {
      setError(loginFailureMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <CenteredState>
      <Card className="w-full max-w-sm shadow-none">
        <CardHeader>
          <div className="mb-2 grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <LockKeyhole className="size-4" aria-hidden="true" />
          </div>
          <CardTitle>{t("gate.login.title")}</CardTitle>
          <CardDescription>{t("gate.login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="ops-username">{t("gate.login.username")}</Label>
              <Input
                id="ops-username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ops-password">{t("gate.login.password")}</Label>
              <Input
                id="ops-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              {submitting ? t("gate.login.submitting") : t("gate.login.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </CenteredState>
  );
}

export function AppGate() {
  const { phase, error, reload, logout } = useOps();

  switch (phase) {
    case "ready":
      return <AppShell />;
    case "anonymous":
      return <LoginScreen />;
    case "loading":
      return (
        <CenteredState>
          <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            {t("gate.checking")}
          </div>
        </CenteredState>
      );
    case "forbidden":
      return (
        <CenteredState>
          <Card className="w-full max-w-md shadow-none">
            <CardHeader>
              <ShieldX className="mb-2 size-7 text-destructive" aria-hidden="true" />
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
    case "error":
      return (
        <CenteredState>
          <Card className="w-full max-w-md shadow-none">
            <CardHeader>
              <ServerCrash className="mb-2 size-7 text-destructive" aria-hidden="true" />
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
