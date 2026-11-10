"use client";

import { useMemo, useState } from "react";

import type { InterfaceLocale } from "@/i18n";

import {
  activeMention,
  matchMentions,
  type ActiveMention,
  type MentionCandidate,
} from "./composerMentions";

interface Options {
  text: string;
  candidates: readonly MentionCandidate[];
  locale: InterfaceLocale;
  /** False while the draft is code, where an @ is just a character. */
  enabled: boolean;
}

/**
 * The suggestion list for the `@name` under the caret: which members match,
 * which one is highlighted, and whether Escape has put the list away.
 *
 * The caret is state here rather than read from the field, because the list
 * has to re-evaluate when the caret moves without the text changing.
 */
export function useMentionSuggestions({ text, candidates, locale, enabled }: Options) {
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const mention: ActiveMention | null = enabled ? activeMention(text, caret) : null;
  const query = mention?.query;
  const matches = useMemo(
    () => (query === undefined ? [] : matchMentions(candidates, query, locale)),
    [candidates, query, locale],
  );
  const open = mention !== null && mention.key !== dismissedKey && matches.length > 0;

  return {
    /** The mention being typed, whether or not the list is showing. */
    mention,
    open,
    matches,
    selectedIndex: index,
    selected: matches[index] ?? matches[0],
    /** The caret moved or the text changed: start again from the first match. */
    track(position: number) {
      setCaret(position);
      setIndex(0);
      setDismissedKey(null);
    },
    step(direction: 1 | -1) {
      setIndex((current) => (current + direction + matches.length) % matches.length);
    },
    dismiss() {
      setDismissedKey(mention?.key ?? null);
    },
  };
}
