"use client";

import { useEffect, useMemo } from "react";

import type { MessageTranslationOptions } from "@/components/room/attachments/TranslatedTextAttachment";
import { cancelPending } from "@/lib/chatTranslation/translate";
import { useLanguage } from "@/state/hooks";

/**
 * The language settings as a transcript reads them, plus the housekeeping that
 * goes with them: translations still queued for the conversation the reader
 * just left are of no use to anyone, so they are dropped when it changes.
 */
export function useChatTranslation(
  conversationId: string | null | undefined,
): MessageTranslationOptions {
  const {
    locale,
    t,
    chatTranslationEnabled,
    chatAutoTranslateEnabled,
    chatTranslationTargetLanguage,
  } = useLanguage();

  useEffect(() => () => cancelPending(), [conversationId]);

  return useMemo(
    () => ({
      locale,
      enabled: chatTranslationEnabled,
      autoTranslate: chatAutoTranslateEnabled,
      targetLanguage: chatTranslationTargetLanguage,
      t,
    }),
    [
      locale,
      t,
      chatTranslationEnabled,
      chatAutoTranslateEnabled,
      chatTranslationTargetLanguage,
    ],
  );
}
