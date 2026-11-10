"use client";

import { useState, type FormEvent } from "react";

import type { InterfaceLocale, Translator } from "@/i18n";
import { triggerHaptic } from "@/lib/haptics";

import type { CodeLanguageId } from "./codeLanguages";
import type { ComposerChip } from "./ComposerChips";
import { fencedCode } from "./composerText";
import { MESSAGE_MAX_LENGTH } from "./messageLimits";

interface Options {
  chips: readonly ComposerChip[];
  /** Receives the trimmed text, fenced when the draft is a code message. */
  onSubmit(text: string): Promise<void> | void;
  /** The draft was delivered and consumed. */
  onSent(): void;
  locale: InterfaceLocale;
  t: Translator;
}

/**
 * The text being written and what it takes to send it: the code-message mode,
 * whether a send is in flight, and why the last one failed.
 */
export function useComposerDraft({ chips, onSubmit, onSent, locale, t }: Options) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [codeMode, setCodeMode] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguageId>("plaintext");

  const hasPayload = text.trim().length > 0 || chips.length > 0;
  const attachmentsBlocked = chips.some((chip) => chip.status !== "ready");
  const canSend = hasPayload && !attachmentsBlocked && !sending;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    // Acknowledge the deliberate send gesture, not every keystroke. Kept in the
    // submit stack so mobile browsers can use their native haptic path.
    triggerHaptic("selection");
    setSending(true);
    setSendError(null);
    try {
      const draft = text;
      const authored = draft.trim();
      const body = codeMode ? fencedCode(codeLanguage, authored) : authored;
      if (body.length > MESSAGE_MAX_LENGTH) {
        setSendError(
          t("composer.codeTooLong", {
            count: MESSAGE_MAX_LENGTH.toLocaleString(locale === "en" ? "en-GB" : "pl-PL"),
          }),
        );
        return;
      }
      await onSubmit(body);
      // A slow request must not erase what was typed after the send started.
      // In the usual append case only the delivered prefix is consumed; if the
      // original was edited in place, the whole current draft is kept.
      setText((current) =>
        current.startsWith(draft) ? current.slice(draft.length).trimStart() : current,
      );
      setCodeMode(false);
      onSent();
    } catch {
      // The text stays in the field: a failed send must not lose what was written.
      setSendError(t("composer.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return {
    text,
    setText,
    sending,
    sendError,
    clearSendError: () => setSendError(null),
    codeMode,
    setCodeMode,
    codeLanguage,
    setCodeLanguage,
    hasPayload,
    attachmentsBlocked,
    canSend,
    submit,
  };
}
