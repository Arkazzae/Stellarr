"use client";

import { useId, useState, type FormEvent } from "react";

import { Icon } from "@/components/icons/Icon";
import type { Translator } from "@/i18n";
import type { RegistrationInput } from "@/ports";

import { AuthField } from "./AuthField";
import { AuthFrame, authStyles as styles } from "./AuthFrame";
import setup from "./InitialServerSetup.module.css";

export type InitialServer = NonNullable<RegistrationInput["initialServer"]>;

export function InitialServerSetup({ value, onChange, onContinue, t }: {
  value: InitialServer;
  onChange: (value: InitialServer) => void;
  onContinue: () => void;
  t: Translator;
}) {
  const errorId = useId();
  const [voice, setVoice] = useState(value.voiceChannelName.length > 0);
  const [issue, setIssue] = useState<{ field: keyof InitialServer; message: string } | null>(null);
  const update = (field: keyof InitialServer, text: string) => onChange({ ...value, [field]: text });
  const normalized = (name: string) => name.trim().toLowerCase();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const channelValid = (name: string) => /^[\p{L}\p{N}-]{1,60}$/u.test(normalized(name));
    const problem = !value.name.trim() || value.name.trim().length > 80
      ? { field: "name" as const, message: t("auth.setup.invalidName") }
      : !channelValid(value.textChannelName)
        ? { field: "textChannelName" as const, message: t("auth.setup.invalidChannel") }
        : voice && !channelValid(value.voiceChannelName)
          ? { field: "voiceChannelName" as const, message: t("auth.setup.invalidChannel") }
          : voice && normalized(value.textChannelName) === normalized(value.voiceChannelName)
            ? { field: "voiceChannelName" as const, message: t("auth.setup.collision") }
            : null;
    if (problem) {
      setIssue(problem);
      const input = event.currentTarget.elements.namedItem(problem.field);
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    onChange({ ...value, name: value.name.trim(), description: value.description.trim(),
      textChannelName: normalized(value.textChannelName), voiceChannelName: voice ? normalized(value.voiceChannelName) : "" });
    onContinue();
  }

  const fieldStatus = (field: keyof InitialServer) => ({
    invalid: issue?.field === field,
    errorId: issue?.field === field ? errorId : undefined,
  });

  return (
    <AuthFrame title={t("auth.setup.title")} description={t("auth.setup.description")}
      headingAction={<p className={styles.fieldHint}>{t("auth.setup.serverStep")}</p>}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <AuthField label={t("auth.setup.name")} name="name" value={value.name} maxLength={80}
          placeholder={t("auth.setup.namePlaceholder")} onChange={(e) => update("name", e.target.value)} {...fieldStatus("name")} />
        <AuthField label={t("auth.setup.descriptionLabel")} name="description" value={value.description} maxLength={280}
          placeholder={t("auth.setup.descriptionPlaceholder")} onChange={(e) => update("description", e.target.value)} />
        <AuthField label={t("auth.setup.textChannel")} hint={t("auth.setup.channelHint")} name="textChannelName"
          value={value.textChannelName} maxLength={60} onChange={(e) => update("textChannelName", e.target.value)} {...fieldStatus("textChannelName")} />
        <label className={setup.check}>
          <input type="checkbox" checked={voice} onChange={(e) => {
            setVoice(e.target.checked);
            update("voiceChannelName", e.target.checked ? t("auth.setup.defaultVoice") : "");
          }} />
          {t("auth.setup.voice")}
        </label>
        {voice ? <AuthField label={t("auth.setup.voiceChannel")} name="voiceChannelName" value={value.voiceChannelName}
          maxLength={60} onChange={(e) => update("voiceChannelName", e.target.value)} {...fieldStatus("voiceChannelName")} /> : null}
        <section className={setup.preview} aria-label={t("auth.setup.preview")}>
          <div className={setup.identity}>
            <span className={setup.mark} aria-hidden="true">{(value.name.trim() || "S").slice(0, 2).toUpperCase()}</span>
            <div><strong>{value.name.trim() || t("auth.setup.emptyName")}</strong><p>{t("auth.setup.private")}</p></div>
          </div>
          {value.description.trim() ? <p>{value.description.trim()}</p> : null}
          <p className={setup.channel}><Icon name="hash" />{normalized(value.textChannelName) || t("auth.setup.defaultText")}</p>
          {voice ? <p className={setup.channel}><Icon name="speaker" />{normalized(value.voiceChannelName) || t("auth.setup.defaultVoice")}</p> : null}
        </section>
        {issue ? <p id={errorId} className={styles.error} role="alert">{issue.message}</p> : null}
        <button className={styles.submit} type="submit">{t("auth.setup.continue")}</button>
      </form>
    </AuthFrame>
  );
}
