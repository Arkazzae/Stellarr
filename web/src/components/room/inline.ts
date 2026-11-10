/**
 * Inline formatting of a message body.
 *
 * `Message.content` is whatever a stranger typed, so the transcript never sees a
 * string it may trust. A body is parsed into the nodes below and components
 * render nodes, never markup. This module is the only place that decides what
 * counts as formatting; anything it does not recognise stays literal text, which
 * React escapes on output.
 */

import { Lexer, Marked, type MarkedToken, type Token, type TokenizerExtension } from "marked";

/** A run inside a text body. `text` is literal; React escapes it. */
export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "emphasis" | "strike" | "spoiler"; text: string; children?: InlineNode[] }
  | { kind: "link"; href: string; text: string }
  | {
      kind: "mention";
      text: string;
      userId: string;
      username: string;
      displayName: string;
      self: boolean;
    }
  /**
   * One of the server's own emoji, written `:code:` in the body.
   *
   * A node rather than a substitution back into the text, because it renders as
   * an `<img>` from the server and its URL comes from the server's own list,
   * never from anything the sender typed. `:not_an_emoji:` stays literal.
   */
  | { kind: "emoji"; shortcode: string; src: string }
  /**
   * The "(edytowano)" mark at the end of a message its author rewrote.
   *
   * A node rather than appended text, because nobody typed it: it must not be
   * selectable or searchable as part of the body, and typing the same characters
   * must not produce it.
   */
  | { kind: "edited"; at: string };

export interface MentionTarget {
  userId: string;
  username: string;
  displayName: string;
  self?: boolean;
}

export interface ParseInlineOptions {
  /** Allow `<b>`. True only for system notices. */
  strong?: boolean;
  /**
   * The server's custom emoji, shortcode to image URL. The map is the
   * allow-list: a shortcode without an entry stays literal text.
   */
  emoji?: ReadonlyMap<string, string>;
  /** Lower-cased username to the member a mention resolves to. */
  mentions?: ReadonlyMap<string, MentionTarget>;
}

/* ---------------------------------------------------- literal text recognisers */

/** Only http(s), up to whitespace or a character that is never raw in a URL. */
const URL_RUN = /https?:\/\/[^\s<>"'`]+/g;

/** Punctuation that far more often ends the sentence than the URL. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "…", "'", '"']);

function trimUrl(raw: string): string {
  let end = raw.length;
  while (end > 0) {
    const last = raw[end - 1] ?? "";
    if (TRAILING.has(last)) {
      end -= 1;
      continue;
    }
    // A closing bracket belongs to the URL only if it was opened inside it:
    // "(see https://x/a)" keeps the paren out, "…/a_(b)" keeps it in.
    if (last === ")" || last === "]") {
      const open = last === ")" ? "(" : "[";
      const head = raw.slice(0, end);
      if (head.split(last).length > head.split(open).length) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return raw.slice(0, end);
}

/** `@name`: usernames are letters, digits, `_`, `.` and `-`, 2 to 32 long. */
const MENTION_RUN = /@([\p{L}\p{N}_.-]{2,32})/gu;
const USERNAME_CHARACTER = /[\p{L}\p{N}_.-]/u;

/**
 * `:code:` is narrow on purpose (letters, digits, `_`, `-`): otherwise every
 * colon in a sentence is a candidate and "18:30 :" starts looking for an emoji
 * called "30".
 */
const SHORTCODE = /:([a-zA-Z0-9_-]{2,64}):/g;

interface Replacement {
  node: InlineNode;
  /** How much of the text the node stands for, from the start of the match. */
  length: number;
}

/**
 * Replaces the matches of `pattern` inside the text nodes with whatever
 * `replace` makes of them. A match it declines, and everything between matches,
 * stays text. Nodes that are not text pass through untouched.
 */
function replaceInText(
  nodes: readonly InlineNode[],
  pattern: RegExp,
  replace: (match: RegExpExecArray, text: string) => Replacement | undefined,
): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if (node.kind !== "text") return [node];

    const out: InlineNode[] = [];
    let cursor = 0;
    for (const match of node.text.matchAll(pattern)) {
      const found = replace(match, node.text);
      if (found === undefined) continue;
      if (match.index > cursor) out.push({ kind: "text", text: node.text.slice(cursor, match.index) });
      out.push(found.node);
      cursor = match.index + found.length;
    }
    if (out.length === 0) return [node];
    if (cursor < node.text.length) out.push({ kind: "text", text: node.text.slice(cursor) });
    return out;
  });
}

function linkify(nodes: readonly InlineNode[]): InlineNode[] {
  return replaceInText(nodes, URL_RUN, (match) => {
    const href = trimUrl(match[0]);
    return href.length === 0 ? undefined : { node: { kind: "link", href, text: href }, length: href.length };
  });
}

/** Resolves real members only; any other `@word` remains ordinary text. */
function mentionify(
  nodes: InlineNode[],
  mentions: ReadonlyMap<string, MentionTarget> | undefined,
): InlineNode[] {
  if (mentions === undefined || mentions.size === 0) return nodes;

  return replaceInText(nodes, MENTION_RUN, (match, text) => {
    // "mail@example.com" and "@ada.x" are not a mention of "ada".
    const before = text[match.index - 1];
    const after = text[match.index + match[0].length];
    if (before !== undefined && USERNAME_CHARACTER.test(before)) return undefined;
    if (after !== undefined && USERNAME_CHARACTER.test(after)) return undefined;

    const target = mentions.get((match[1] ?? "").toLocaleLowerCase());
    if (target === undefined) return undefined;
    return {
      node: {
        kind: "mention",
        text: match[0],
        userId: target.userId,
        username: target.username,
        displayName: target.displayName,
        self: target.self === true,
      },
      length: match[0].length,
    };
  });
}

function emojify(
  nodes: InlineNode[],
  emoji: ReadonlyMap<string, string> | undefined,
): InlineNode[] {
  if (emoji === undefined || emoji.size === 0) return nodes;

  return replaceInText(nodes, SHORTCODE, (match) => {
    const shortcode = match[1] ?? "";
    const src = emoji.get(shortcode);
    return src === undefined
      ? undefined
      : { node: { kind: "emoji", shortcode, src }, length: match[0].length };
  });
}

/* --------------------------------------------------------------- markdown */

/**
 * `||hidden||`, shown blurred until clicked. What is inside may carry its own
 * formatting, so it is lexed again rather than kept as flat text.
 */
const SPOILER: TokenizerExtension = {
  name: "spoiler",
  level: "inline",
  start(source) {
    const at = source.indexOf("||");
    return at < 0 ? undefined : at;
  },
  tokenizer(source) {
    const match = /^\|\|(?!\|)([\s\S]*?[^\s|])\|\|/.exec(source);
    if (match === null) return undefined;
    const inner = match[1] ?? "";
    return { type: "spoiler", raw: match[0], text: inner, tokens: this.lexer.inlineTokens(inner) };
  },
};

interface SpoilerToken {
  type: "spoiler";
  raw: string;
  tokens: Token[];
}

const LEXER_OPTIONS = new Marked({ gfm: true, extensions: [SPOILER] }).defaults;

/** Nesting deeper than this is shown as the text it was typed as. */
const MAX_DEPTH = 32;

const STYLE_KINDS = { strong: "strong", em: "emphasis", del: "strike" } as const;

export function inlineText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "emoji") return `:${node.shortcode}:`;
      return node.kind === "edited" ? "" : node.text;
    })
    .join("");
}

/** The nodes and everything nested inside them, so mentions in emphasis are found too. */
export function inlineDescendants(nodes: readonly InlineNode[]): InlineNode[] {
  return nodes.flatMap((node) => [
    node,
    ...("children" in node && node.children ? inlineDescendants(node.children) : []),
  ]);
}

/**
 * The legacy `<code>…</code>`, and `<b>…</b>` where allowed, are the only HTML
 * honoured. Their content is flat: whatever markup is inside stays literal.
 */
function legacyTag(
  tokens: readonly Token[],
  start: number,
  allowBold: boolean,
): { node: InlineNode; end: number } | undefined {
  const open = tokens[start];
  if (open?.type !== "html") return undefined;
  const kind = open.raw === "<code>" ? "code" : allowBold && open.raw === "<b>" ? "strong" : undefined;
  if (kind === undefined) return undefined;

  const close = kind === "code" ? "</code>" : "</b>";
  const end = tokens.findIndex((token, index) => index > start && token.raw === close);
  if (end === -1) return undefined;
  return { node: { kind, text: tokens.slice(start + 1, end).map((t) => t.raw).join("") }, end };
}

function inlineFromTokens(
  tokens: readonly Token[],
  options: ParseInlineOptions,
  depth = 0,
): InlineNode[] {
  const nodes: InlineNode[] = [];
  const append = (node: InlineNode) => {
    const previous = nodes.at(-1);
    if (node.kind === "text" && previous?.kind === "text") previous.text += node.text;
    else nodes.push(node);
  };
  const literal = (text: string) => {
    if (text.length === 0) return;
    const linked = linkify([{ kind: "text", text }]);
    emojify(mentionify(linked, options.mentions), options.emoji).forEach(append);
  };

  for (let index = 0; index < tokens.length; index++) {
    // Only the tokens this lexer can produce are handled; others fall to `default`.
    const token = tokens[index] as MarkedToken | SpoilerToken;
    if (depth >= MAX_DEPTH) {
      append({ kind: "text", text: token.raw });
      continue;
    }

    const legacy = legacyTag(tokens, index, options.strong === true);
    if (legacy !== undefined) {
      append(legacy.node);
      index = legacy.end;
      continue;
    }

    switch (token.type) {
      case "strong":
      case "em":
      case "del":
      case "spoiler": {
        const children = inlineFromTokens(token.tokens, options, depth + 1);
        const kind = token.type === "spoiler" ? "spoiler" : STYLE_KINDS[token.type];
        append({ kind, text: inlineText(children), children });
        break;
      }
      case "codespan":
        append({ kind: "code", text: token.text });
        break;
      case "escape":
        append({ kind: "text", text: token.text });
        break;
      case "br":
        append({ kind: "text", text: "\n" });
        break;
      case "link":
        // Labels are plain: no mentions or emoji inside a link's own text.
        if (/^https?:\/\//i.test(token.href)) {
          const label = inlineText(inlineFromTokens(token.tokens, {}, depth + 1));
          append({ kind: "link", href: token.href, text: label });
        } else {
          append({ kind: "text", text: token.raw });
        }
        break;
      case "text":
        literal(token.text);
        break;
      default:
        append({ kind: "text", text: token.raw });
    }
  }
  return nodes;
}

/**
 * Tokenizes Markdown but never generates or trusts HTML: links must be http(s),
 * images are never loaded, and markup the sender typed stays literal text.
 */
export function parseInline(content: string, options: ParseInlineOptions = {}): InlineNode[] {
  try {
    return inlineFromTokens(Lexer.lexInline(content, LEXER_OPTIONS), options);
  } catch {
    // Pathologically nested input must remain readable.
    return [{ kind: "text", text: content }];
  }
}
