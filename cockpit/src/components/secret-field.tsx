import { useId, useState, type KeyboardEvent } from "react";

import { Spinner } from "@/components/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { formatShortDateTime } from "@/i18n/format";
import { cockpitApi, type CockpitSecret } from "@/lib/api";

interface SecretFieldProps {
  title: string;
  /** The secret's state; null while it loads. */
  secret: CockpitSecret | null;
  /** Called with the new state once a value was set or removed. */
  onChanged: (secret: CockpitSecret) => void;
}

function SourceBadge({ secret }: { secret: CockpitSecret }) {
  if (secret.source === "panel") return <Badge variant="success">{t("secret.source.panel")}</Badge>;
  if (secret.source === "environment") return <Badge variant="secondary">{t("secret.source.environment")}</Badge>;
  return <Badge variant="outline">{t("secret.source.none")}</Badge>;
}

/**
 * A secret the panel can set, replace or remove but never read back. The
 * field always starts empty; what it shows is only whether a value is set and
 * where it comes from. It is not a form of its own, so it can sit inside one:
 * Enter saves the secret instead of submitting the page around it.
 */
export function SecretField({ title, secret, onChanged }: SecretFieldProps) {
  const id = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "save" | "clear") {
    if (!secret) return;
    setBusy(action);
    setError(null);
    try {
      const next =
        action === "save" ? await cockpitApi.setSecret(secret.name, value) : await cockpitApi.clearSecret(secret.name);
      setValue("");
      onChanged(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("secret.failed"));
    } finally {
      setBusy(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (value.trim()) void run("save");
  }

  const variable = secret ? <code className="rounded bg-background px-1 py-0.5 text-xs">{secret.variable}</code> : null;

  return (
    <div className="space-y-3 border-t pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor={id}>{title}</Label>
          {secret ? (
            <p id={`${id}-state`} className="mt-1 text-sm leading-6 text-muted-foreground">
              {secret.source === "panel" ? (
                <>
                  {t("secret.state.panel", { date: secret.updatedAt ? formatShortDateTime(secret.updatedAt) : "" })}{" "}
                  {t("secret.state.panelFallback")} {variable}.
                </>
              ) : secret.source === "environment" ? (
                <>
                  {t("secret.state.environment")} {variable}. {t("secret.state.environmentOverride")}
                </>
              ) : (
                <>
                  {t("secret.state.none")} {variable}.
                </>
              )}
            </p>
          ) : null}
        </div>
        {secret ? <SourceBadge secret={secret} /> : <Spinner />}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          placeholder={secret?.configured ? t("secret.replacePlaceholder") : t("secret.placeholder")}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={!secret || busy !== null}
          aria-describedby={secret ? `${id}-state` : undefined}
          aria-invalid={Boolean(error)}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="outline" disabled={!secret || !value.trim() || busy !== null} onClick={() => void run("save")}>
          {busy === "save" ? <Spinner /> : null}
          {secret?.configured ? t("secret.replace") : t("secret.save")}
        </Button>
        {secret?.source === "panel" ? (
          <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void run("clear")}>
            {busy === "clear" ? <Spinner /> : null}
            {t("secret.remove")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
