import type { InterfaceLocale } from "@/i18n";

import type { TextEdit } from "./composerText";

export interface MentionCandidate {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

/** The `@name` being typed at the caret. */
export interface ActiveMention {
  start: number;
  end: number;
  query: string;
  /** Changes whenever the mention does; lets Escape dismiss exactly this one. */
  key: string;
}

const MAX_SUGGESTIONS = 8;

/** An `@` that opens a word, followed by the characters a username can hold. */
const MENTION_BEFORE_CARET = /(?:^|\s)@([\p{L}\p{N}_.-]{0,32})$/u;

export function activeMention(text: string, caret: number): ActiveMention | null {
  const match = MENTION_BEFORE_CARET.exec(text.slice(0, caret));
  if (match === null) return null;
  const query = match[1] ?? "";
  const start = caret - query.length - 1;
  return { start, end: caret, query, key: `${start}:${query}` };
}

/** Usernames that start with the query come first, then display-name matches. */
export function matchMentions(
  candidates: readonly MentionCandidate[],
  query: string,
  locale: InterfaceLocale,
): MentionCandidate[] {
  const needle = query.toLocaleLowerCase();
  const startsWith = (candidate: MentionCandidate) =>
    candidate.username.toLocaleLowerCase().startsWith(needle);

  return candidates
    .filter(
      (candidate) =>
        startsWith(candidate) || candidate.displayName.toLocaleLowerCase().includes(needle),
    )
    .sort(
      (left, right) =>
        Number(startsWith(right)) - Number(startsWith(left)) ||
        left.username.localeCompare(right.username, locale),
    )
    .slice(0, MAX_SUGGESTIONS);
}

/** Replaces the typed `@query` with `@username`, followed by a space if none follows. */
export function insertMention(
  text: string,
  mention: ActiveMention,
  username: string,
): TextEdit {
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.end);
  const trail = /^\s/.test(after) ? "" : " ";
  const inserted = `@${username}${trail}`;
  const caret = before.length + inserted.length;
  return { text: `${before}${inserted}${after}`, selectionStart: caret, selectionEnd: caret };
}
