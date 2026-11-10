"use client";

import { useState } from "react";

import type { MessageKey } from "@/i18n";
import type { AddFriendResult } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

const ANSWER_KEY: Record<AddFriendResult, MessageKey> = {
  sent: "friends.addSent",
  "unknown-user": "friends.addUnknown",
  "already-friends": "friends.addAlreadyFriends",
  "already-sent": "friends.addAlreadySent",
  self: "friends.addSelf",
  blocked: "friends.addBlocked",
};

export interface AddFriendForm {
  typed: string;
  /** What the server said to the last invitation, as a whole sentence. */
  answer: { result: AddFriendResult; text: string } | null;
  submitting: boolean;
  type: (value: string) => void;
  submit: () => Promise<void>;
}

/**
 * The state of the add-friend form.
 *
 * It lives with the view rather than inside the panel, so the name someone
 * typed and the answer they got are still there after a look at another tab.
 */
export function useAddFriend(
  send: (username: string) => Promise<AddFriendResult>,
): AddFriendForm {
  const { t } = useLanguage();
  const [typed, setTyped] = useState("");
  const [answer, setAnswer] = useState<AddFriendForm["answer"]>(null);
  const [submitting, setSubmitting] = useState(false);

  const type = (value: string) => {
    setTyped(value);
    setAnswer(null);
  };

  const submit = async () => {
    const name = typed.trim();
    if (name.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const result = await send(name);
      const who = `@${name.replace(/^@/, "")}`;
      setAnswer({ result, text: t(ANSWER_KEY[result], { who }) });
      if (result === "sent") setTyped("");
    } finally {
      setSubmitting(false);
    }
  };

  return { typed, answer, submitting, type, submit };
}
