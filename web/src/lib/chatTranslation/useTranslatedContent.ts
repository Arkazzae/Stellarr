"use client";

import { useEffect, useState } from "react";

import type { TranslationTargetLanguage } from "@/i18n";

import { TranslationCancelledError, translate } from "./translate";

export interface TranslationResult {
  translatedContent: string | null;
  loading: boolean;
  error: Error | null;
}

interface Outcome {
  content: string;
  targetLanguage: TranslationTargetLanguage;
  retryKey: number | undefined;
  translatedContent: string | null;
  error: Error | null;
}

const IDLE: TranslationResult = { translatedContent: null, loading: false, error: null };

/**
 * Translates `content` once `trigger` is true. The result belongs to the
 * request that produced it, so changing the content or language reads as
 * loading straight away instead of showing the previous translation.
 * Bump `retryKey` to ask again after a failure.
 */
export function useTranslatedContent(
  content: string,
  targetLanguage: TranslationTargetLanguage,
  options: { trigger: boolean; priority?: boolean; retryKey?: number },
): TranslationResult {
  const { trigger, priority, retryKey } = options;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const requested = trigger && content.trim().length > 0;

  useEffect(() => {
    if (!requested) return;
    let current = true;
    const finish = (translatedContent: string | null, error: Error | null) => {
      if (current) {
        setOutcome({ content, targetLanguage, retryKey, translatedContent, error });
      }
    };

    translate(content, targetLanguage, { priority }).then(
      (translation) => finish(translation, null),
      (reason: unknown) => {
        // Leaving the room cancels queued work, which is not a failure to report.
        if (reason instanceof TranslationCancelledError) return finish(null, null);
        finish(null, reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      current = false;
    };
  }, [requested, content, targetLanguage, priority, retryKey]);

  if (!requested) return IDLE;
  const settled =
    outcome !== null &&
    outcome.content === content &&
    outcome.targetLanguage === targetLanguage &&
    outcome.retryKey === retryKey;
  return settled
    ? { translatedContent: outcome.translatedContent, loading: false, error: outcome.error }
    : { translatedContent: null, loading: true, error: null };
}
