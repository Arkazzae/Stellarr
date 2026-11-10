import type { CustomEmoji } from "@/ports";

/**
 * The small, deliberately limited Markdown a profile bio accepts.
 *
 * A bio is written by another user, so it never becomes HTML: the parser
 * returns a closed union and React escapes every text run. Supporting only what
 * the profile editor offers also keeps a profile card from turning into a
 * second message composer.
 */
export type ProfileBioNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "emphasis"; text: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "emoji"; glyph: string; shortcode: string };

export interface ProfileBioTextProps {
  text: string;
  customEmoji?: readonly CustomEmoji[];
}

const SHORTCODE = /:(?<code>[a-zA-Z0-9_-]{2,64}):/;

/**
 * Every construct a bio can contain, as alternatives tried left to right at
 * each position. Only http(s) addresses are links: anything else, such as
 * `javascript:`, never matches and stays visible as typed.
 */
const TOKEN = new RegExp(
  [
    /\*\*(?<strong>[^*\n]+)\*\*/,
    /\*(?<emphasis>[^*\n]+)\*/,
    /\[(?<label>[^\]\n]+)\]\((?<href>https?:\/\/[^\s<>)]+)\)/,
    /(?<bare>https?:\/\/[^\s<>"'`]+)/,
    SHORTCODE,
  ]
    .map((part) => part.source)
    .join("|"),
  "g",
);

/** Punctuation that closes a sentence far more often than it ends an address. */
const SENTENCE_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "…", "'", '"']);

const BRACKET_PAIRS: Record<string, string> = { ")": "(", "]": "[" };

/**
 * A bare address as the writer meant it. Trailing punctuation belongs to the
 * sentence, and so does a closing bracket that has no opener in the address
 * (`(see https://example.com)`), while a balanced one stays
 * (`https://en.wikipedia.org/wiki/Foo_(bar)`).
 */
function trimBareUrl(raw: string): string {
  let end = raw.length;
  while (end > 0) {
    const last = raw.charAt(end - 1);
    if (SENTENCE_PUNCTUATION.has(last)) {
      end -= 1;
      continue;
    }
    const opener = BRACKET_PAIRS[last];
    if (opener !== undefined) {
      const kept = raw.slice(0, end);
      if (kept.split(last).length > kept.split(opener).length) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return raw.slice(0, end);
}

/** Shortcodes are stored with their colons, and typed without them. */
function emojiByShortcode(
  customEmoji: readonly CustomEmoji[],
): Map<string, CustomEmoji> {
  return new Map(
    customEmoji.map((emoji) => [emoji.shortcode.replace(/^:|:$/g, ""), emoji]),
  );
}

interface Token {
  node: ProfileBioNode;
  /** How much of the source the node stands for. */
  length: number;
}

function readToken(
  match: RegExpExecArray,
  emoji: ReadonlyMap<string, CustomEmoji>,
): Token {
  const { strong, emphasis, label, href, bare, code }: Record<
    string,
    string | undefined
  > = match.groups ?? {};
  const raw = match[0];

  if (strong !== undefined) {
    return { node: { kind: "strong", text: strong }, length: raw.length };
  }
  if (emphasis !== undefined) {
    return { node: { kind: "emphasis", text: emphasis }, length: raw.length };
  }
  if (label !== undefined && href !== undefined) {
    return { node: { kind: "link", href, text: label }, length: raw.length };
  }
  if (code !== undefined) {
    const known = emoji.get(code);
    return {
      node:
        known === undefined
          ? { kind: "text", text: raw }
          : { kind: "emoji", glyph: known.glyph, shortcode: code },
      length: raw.length,
    };
  }

  const url = trimBareUrl(bare ?? raw);
  return { node: { kind: "link", href: url, text: url }, length: url.length };
}

/**
 * Parses bold, emphasis, labelled http(s) links, bare http(s) links and known
 * server emoji. Unclosed or unsupported markup stays literal, so a typing
 * mistake shows up on the card instead of quietly eating someone's words.
 */
export function parseProfileBio(
  source: string,
  customEmoji: readonly CustomEmoji[] = [],
): ProfileBioNode[] {
  const emoji = emojiByShortcode(customEmoji);
  // Its own instance: a bare address gives back the punctuation it was trimmed
  // of, which means moving `lastIndex` backwards.
  const token = new RegExp(TOKEN);
  const nodes: ProfileBioNode[] = [];
  let cursor = 0;

  for (
    let match = token.exec(source);
    match !== null;
    match = token.exec(source)
  ) {
    if (match.index > cursor) {
      nodes.push({ kind: "text", text: source.slice(cursor, match.index) });
    }
    const { node, length } = readToken(match, emoji);
    nodes.push(node);
    cursor = match.index + length;
    token.lastIndex = cursor;
  }

  if (cursor < source.length) {
    nodes.push({ kind: "text", text: source.slice(cursor) });
  }
  return nodes;
}

function EmojiImage({ glyph, shortcode }: { glyph: string; shortcode: string }) {
  const name = `:${shortcode}:`;
  return (
    <img
      className="profile-bio-emoji"
      src={glyph}
      alt={name}
      title={name}
      loading="lazy"
    />
  );
}

/**
 * The compact status line: custom emoji, but no Markdown and no links. It is
 * rendered inside the account row's button, where an anchor would be invalid.
 */
export function CustomStatusText({
  text,
  customEmoji = [],
}: ProfileBioTextProps) {
  const emoji = emojiByShortcode(customEmoji);
  // Splitting on a capturing pattern alternates text and shortcode.
  const parts = text.split(SHORTCODE);

  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 0) return part;
        const known = emoji.get(part);
        return known === undefined ? (
          `:${part}:`
        ) : (
          <EmojiImage key={index} glyph={known.glyph} shortcode={part} />
        );
      })}
    </>
  );
}

/** The safe renderer shared by the editor's preview and every mini profile. */
export function ProfileBioText({
  text,
  customEmoji = [],
}: ProfileBioTextProps) {
  return (
    <>
      {parseProfileBio(text, customEmoji).map((node, index) => {
        switch (node.kind) {
          case "text":
            return node.text;
          case "strong":
            return <strong key={index}>{node.text}</strong>;
          case "emphasis":
            return <em key={index}>{node.text}</em>;
          case "link":
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="ugc nofollow noopener noreferrer"
              >
                {node.text}
              </a>
            );
          case "emoji":
            return (
              <EmojiImage
                key={index}
                glyph={node.glyph}
                shortcode={node.shortcode}
              />
            );
        }
      })}
    </>
  );
}
