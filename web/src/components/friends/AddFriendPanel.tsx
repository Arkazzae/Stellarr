"use client";

import { useId } from "react";

import { Button } from "@stellarr/ui";
import { useLanguage } from "@/state/LanguageProvider";

import type { AddFriendForm } from "./useAddFriend";

/** The "Dodaj znajomego" form and the sentence the server answers it with. */
export function AddFriendPanel({ form }: { form: AddFriendForm }) {
  const { t } = useLanguage();
  const inputId = useId();
  const { typed, answer, submitting } = form;
  const accepted = answer?.result === "sent";

  return (
    <section className="fr-add-panel" aria-label={t("friends.addFriend")}>
      <h3>{t("friends.addFriend")}</h3>
      <p className="fr-help">{t("friends.addHelp")}</p>
      <form
        className="fr-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          {t("friends.username")}
        </label>
        <input
          id={inputId}
          type="text"
          value={typed}
          placeholder={t("friends.usernameExample")}
          autoComplete="off"
          aria-invalid={answer !== null && !accepted ? true : undefined}
          onChange={(event) => form.type(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={typed.trim().length === 0 || submitting}
        >
          {t("friends.sendInvite")}
        </Button>
      </form>
      {answer === null ? null : (
        <p
          className={accepted ? "fr-answer ok" : "fr-answer bad"}
          role={accepted ? "status" : "alert"}
        >
          {answer.text}
        </p>
      )}
    </section>
  );
}
