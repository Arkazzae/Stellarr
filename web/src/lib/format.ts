import { translateMessage, type InterfaceLocale } from "@/i18n";
import { documentLocale } from "@/i18n/defaultLocale";
import type { Message, MessageReference } from "@/lib/api/types";

// Every formatter takes the locale to speak in, and the app always passes the
// provider's. Only the four that put words into a transcript (`formatDay`,
// `messageReference`, `buildTranscript`, `buildThreadTranscript`) fall back to
// the page's language, for a caller with no provider to ask.

const LOCALE_TAG: Record<InterfaceLocale, string> = {
  pl: "pl-PL",
  en: "en-GB",
};

/** Formats a timestamp, or returns "" for one that does not parse. */
function formatWith(
  iso: string,
  locale: InterfaceLocale,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], options).format(date);
}

export function formatTime(iso: string, locale: InterfaceLocale): string {
  return formatWith(iso, locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatFull(iso: string, locale: InterfaceLocale): string {
  return formatWith(iso, locale, { dateStyle: "medium", timeStyle: "short" });
}

/** A calendar date without a time: "12 March 2025". */
export function formatDate(iso: string, locale: InterfaceLocale): string {
  return formatWith(iso, locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** A day heading: "Today", "Yesterday", or the weekday and date. */
export function formatDay(
  iso: string,
  now = new Date(),
  locale: InterfaceLocale = documentLocale(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (isSameDay(date, now)) return translateMessage(locale, "format.today");

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return translateMessage(locale, "format.yesterday");

  return formatWith(iso, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Which `.one`, `.few` or `.many` form of a counted message the locale's
 * plural rules pick. Every category but `one` and `few` reads as `many`, which
 * also covers English, where only `one` and `other` exist.
 */
export function pluralForm(locale: InterfaceLocale, count: number): "one" | "few" | "many" {
  const category = new Intl.PluralRules(locale).select(count);
  return category === "one" || category === "few" ? category : "many";
}

/**
 * How long ago, in words: "just now", "6 minutes ago", "yesterday".
 *
 * Deliberately coarse and never live-updating: it sits under a name in a list,
 * where "yesterday" is all the reader wants.
 */
export function formatAgo(iso: string, now: Date, locale: InterfaceLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return translateMessage(locale, "format.agoJustNow");
  if (minutes < 60) {
    return translateMessage(locale, `format.agoMinutes.${pluralForm(locale, minutes)}`, {
      count: minutes,
    });
  }
  if (hours < 24) {
    return translateMessage(locale, `format.agoHours.${pluralForm(locale, hours)}`, {
      count: hours,
    });
  }
  if (days === 1) return translateMessage(locale, "format.agoYesterday");
  if (days < 30) return translateMessage(locale, "format.agoDays", { count: days });
  return formatDate(iso, locale);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const [first = "", second] = words;
  if (words.length === 0) return "?";
  if (second === undefined) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase();
}

const PREVIEW_CHARS = 140;

/**
 * The one line a reply prints above itself. A message with nothing but an
 * attachment has no words to quote, so the line says what it is instead: an
 * empty line above a reply would look like a bug.
 */
export function messageReference(
  message: Message,
  locale: InterfaceLocale = documentLocale(),
): MessageReference {
  const content = message.content.replace(/\s+/g, " ").trim();
  const hasAttachment = message.attachments.length > 0;

  let preview = content;
  if (content.length > PREVIEW_CHARS) {
    preview = `${content.slice(0, PREVIEW_CHARS - 1)}…`;
  } else if (content.length === 0 && hasAttachment) {
    preview = translateMessage(locale, "format.attachmentPreview");
  }

  return {
    id: message.id,
    authorId: message.author.id,
    authorName: message.author.displayName,
    preview,
    ...(hasAttachment ? { hasAttachment } : {}),
  };
}

/** Messages by one author within this window render under one header. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface MessageGroup {
  key: string;
  authorId: string;
  authorName: string;
  startedAt: string;
  messages: Message[];
}

export interface TranscriptSection {
  /** The day heading, e.g. "Today". */
  day: string;
  groups: MessageGroup[];
}

/** Splits a flat message list into day sections and author groups. */
export function buildTranscript(
  messages: Message[],
  now = new Date(),
  locale: InterfaceLocale = documentLocale(),
): TranscriptSection[] {
  const sections: TranscriptSection[] = [];

  for (const message of messages) {
    const day = formatDay(message.createdAt, now, locale);
    let section = sections.at(-1);
    if (section?.day !== day) {
      section = { day, groups: [] };
      sections.push(section);
    }

    const group = section.groups.at(-1);
    const last = group?.messages.at(-1);
    const withinWindow =
      last !== undefined &&
      Math.abs(
        new Date(message.createdAt).getTime() - new Date(last.createdAt).getTime(),
      ) <= GROUP_WINDOW_MS;

    // A reply always starts its own block: the line above it names a different
    // message, and nothing may hang under that line as if it answered it too.
    const joinsGroup =
      group !== undefined &&
      group.authorId === message.author.id &&
      withinWindow &&
      !group.messages[0]?.replyTo &&
      !message.replyTo;

    if (joinsGroup) {
      group.messages.push(message);
    } else {
      section.groups.push({
        key: message.id,
        authorId: message.author.id,
        authorName: message.author.displayName,
        startedAt: message.createdAt,
        messages: [message],
      });
    }
  }

  return sections;
}

/**
 * The flat conversation shown inside one thread: the root, then its replies.
 *
 * Membership is a message-level relation, so replies are picked out before
 * grouping; filtering a channel after grouping could drag in neighbouring
 * messages that share an author block. Each reply drops its repeated reference
 * to the root, in this presentation copy only. The root is grouped on its own
 * so that a first reply by the same author is not folded into it.
 */
export function buildThreadTranscript(
  messages: Message[],
  rootId: string,
  now = new Date(),
  locale: InterfaceLocale = documentLocale(),
): TranscriptSection[] {
  const root = messages.find((message) => message.id === rootId);
  if (root === undefined) return [];

  const replies = messages
    .filter((message) => message.replyTo?.id === rootId)
    .map(({ replyTo: _replyTo, ...reply }) => reply);

  const sections = buildTranscript([root], now, locale);
  for (const replySection of buildTranscript(replies, now, locale)) {
    const previous = sections.at(-1);
    if (previous?.day === replySection.day) {
      previous.groups.push(...replySection.groups);
    } else {
      sections.push(replySection);
    }
  }
  return sections;
}

/**
 * A channel name as the server stores it: lower case, no spaces, no
 * punctuation but "-". Shared so the channel dialog and the new-server dialog
 * cannot name the same channel two different ways.
 */
export function toChannelSlug(typed: string): string {
  return typed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9ąćęłńóśźż-]/g, "")
    .replace(/-{2,}/g, "-");
}
