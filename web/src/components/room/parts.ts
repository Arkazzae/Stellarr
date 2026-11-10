/**
 * Turns a domain message into the parts the transcript renders.
 *
 * Domain types are imported as types only, so no runtime dependency on the HTTP
 * client reaches a component. The parts, the inline nodes and the highlighter's
 * token types are re-exported here: this is the one module a component imports
 * to talk about message bodies.
 */

import { translateForDocument } from "@/i18n/defaultLocale";
import { formatBytes } from "@/lib/format";
import { giphyIdFromUrl } from "@/lib/giphy";
import type { Attachment, Message, MessageEmbed } from "@/ports";

import { bodyParts } from "./messageBody";
import type {
  AudioPart,
  EmbedPart,
  FilePart,
  MessagePart,
  TextPart,
  VideoEmbedPart,
  VideoPart,
} from "./partTypes";
import type { MentionTarget } from "./inline";

export { tokenizeCode } from "./codeLanguages";
export type { CodeLanguageId, CodeToken } from "./codeLanguages";
export { inlineDescendants, parseInline } from "./inline";
export type { InlineNode, MentionTarget, ParseInlineOptions } from "./inline";
export type {
  AttachmentCallbacks,
  AudioPart,
  CodePart,
  EmbedPart,
  FilePart,
  GalleryImage,
  GalleryPart,
  GiphyPart,
  ImagePart,
  MessagePart,
  TextPart,
  VideoEmbedPart,
  VideoPart,
} from "./partTypes";

/** The object without the fields that are `undefined`, so optional means absent. */
function defined<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/* ------------------------------------------------------------- attachments */

/** `"raport.pdf"` becomes `"PDF"`. Four characters is what the badge fits. */
export function fileExt(
  name: string,
  fallback = translateForDocument("attachment.extFallback"),
): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return fallback;
  return name.slice(dot + 1).toUpperCase().slice(0, 4);
}

/** Seconds as "m:ss". */
function mediaDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function isImage(attachment: Attachment): boolean {
  return attachment.contentType.startsWith("image/");
}

function mediaOrFilePart(
  attachment: Attachment,
  extFallback: string | undefined,
): AudioPart | VideoPart | FilePart {
  const { contentType, name, url, size } = attachment;
  const duration =
    attachment.durationSeconds === undefined ? undefined : mediaDuration(attachment.durationSeconds);

  if (contentType.startsWith("audio/")) {
    return {
      kind: "audio",
      name,
      url,
      size,
      ...defined({ duration, voiceMessage: attachment.isVoiceMessage === true ? true : undefined }),
    };
  }
  if (contentType.startsWith("video/")) {
    return {
      kind: "video",
      name,
      url,
      ...defined({
        thumb: attachment.posterUrl,
        width: attachment.width,
        height: attachment.height,
        duration,
      }),
    };
  }
  return { kind: "file", name, ext: fileExt(name, extFallback), size: formatBytes(size), url };
}

/** One picture is shown as it is; several in a row become a gallery. */
function imageRunPart(run: readonly Attachment[]): MessagePart {
  const [first] = run;
  if (run.length === 1 && first !== undefined) {
    return {
      kind: "image",
      src: first.url,
      alt: first.name,
      ...defined({ width: first.width, height: first.height }),
    };
  }
  return { kind: "gallery", images: run.map((image) => ({ src: image.url, alt: image.name })) };
}

/** Attachments in order, with consecutive images collapsed into one gallery. */
function attachmentParts(
  attachments: readonly Attachment[],
  extFallback: string | undefined,
): MessagePart[] {
  const parts: MessagePart[] = [];
  let images: Attachment[] = [];
  const flushImages = () => {
    if (images.length > 0) parts.push(imageRunPart(images));
    images = [];
  };

  for (const attachment of attachments) {
    if (isImage(attachment)) {
      images.push(attachment);
    } else {
      flushImages();
      parts.push(mediaOrFilePart(attachment, extFallback));
    }
  }
  flushImages();
  return parts;
}

/* ------------------------------------------------------------------ embeds */

/**
 * Maps one unfurled link onto the part that renders it.
 *
 * A card with nothing on it is not a card: a preview with no title,
 * description or picture tells the reader less than the link already in the
 * body, so it becomes nothing at all.
 */
function embedPart(embed: MessageEmbed): EmbedPart | VideoEmbedPart | null {
  if (embed.kind === "video" && embed.providerId !== undefined) {
    return {
      kind: "video-embed",
      provider: embed.provider,
      providerId: embed.providerId,
      url: embed.url,
      domain: embed.domain,
      ...defined({
        title: embed.title,
        description: embed.description,
        thumb: embed.thumbnailUrl,
        startSeconds: embed.startSeconds,
      }),
    };
  }

  if (embed.title === undefined && embed.description === undefined && embed.thumbnailUrl === undefined) {
    return null;
  }
  return {
    kind: "embed",
    domain: embed.domain,
    title: embed.title ?? embed.domain,
    description: embed.description ?? "",
    url: embed.url,
    ...defined({ thumb: embed.thumbnailUrl }),
  };
}

/* ----------------------------------------------------------------- toParts */

export interface ToPartsOptions {
  /** System notices may use `<b>`; see `parseInline`. */
  system?: boolean;
  /** The server's custom emoji, shortcode to image URL. See `ParseInlineOptions`. */
  emoji?: ReadonlyMap<string, string>;
  /** Lower-cased username to the member a mention resolves to. */
  mentions?: ReadonlyMap<string, MentionTarget>;
  /** What the badge of a file with no extension says. Without one, the page's language decides. */
  extFallback?: string;
}

/**
 * The edit mark rides on the last run of prose, where a reader's eye ends up.
 * A message with no text cannot carry one, and cannot have been edited either,
 * since editing is text-only.
 */
function markEdited(parts: MessagePart[], editedAt: string | undefined): void {
  if (editedAt === undefined) return;
  const lastText = [...parts].reverse().find((part): part is TextPart => part.kind === "text");
  if (lastText !== undefined) lastText.nodes = [...lastText.nodes, { kind: "edited", at: editedAt }];
}

/**
 * The parts of a message, in reading order: its text (prose and code blocks),
 * the cards and players for its links, then its attachments.
 */
export function toParts(message: Message, options: ToPartsOptions = {}): MessagePart[] {
  const content = message.content.trim();
  const parts: MessagePart[] = [];

  const giphyId = giphyIdFromUrl(content);
  if (giphyId !== null) {
    // GIPHY's terms prohibit proxying or storing its media. The message keeps
    // the canonical page link, so every reader resolves the current rendition
    // from GIPHY directly while an older client still sees a useful link.
    parts.push({ kind: "giphy", id: giphyId, pageUrl: content });
  } else {
    const previews = message.embeds.flatMap((embed) => {
      const part = embedPart(embed);
      return part === null ? [] : [{ url: embed.url, part }];
    });
    const inline = { strong: options.system, emoji: options.emoji, mentions: options.mentions };
    parts.push(
      ...bodyParts(content, inline, new Set(previews.map((preview) => preview.url))),
      ...previews.map((preview) => preview.part),
    );
  }

  markEdited(parts, message.editedAt);
  parts.push(...attachmentParts(message.attachments, options.extFallback));
  return parts;
}

/* ------------------------------------------------------------------ jumbo */

/**
 * Emoji, and the whitespace between them, and nothing else.
 *
 * Matches the Unicode ranges an emoji occupies, including the joiners and
 * skin-tone modifiers that make one glyph out of several code points. A naive
 * "no letters" test would call "!!!" an emoji and draw it at 40px.
 */
const EMOJI_ONLY = /^(?:\s|\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️)+$/u;

/** How many before a message stops being an exclamation and becomes a wall. */
const JUMBO_MAX = 3;

/** Counts what a reader calls "one emoji": a flag, a family, a thumb with a skin tone. */
const GRAPHEMES =
  typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function graphemes(text: string): string[] {
  return GRAPHEMES === null ? [...text] : Array.from(GRAPHEMES.segment(text), (piece) => piece.segment);
}

/**
 * Whether a body should be drawn large.
 *
 * True only when the whole message is one to three emoji: at that length it is
 * a reaction rather than a sentence, and body size wastes the one bit of
 * expression the format has. A custom `:code:` counts as one, because on screen
 * it is exactly as much emoji as a Unicode one.
 */
export function isJumbo(parts: readonly MessagePart[]): boolean {
  const [only] = parts;
  if (parts.length !== 1 || only?.kind !== "text") return false;

  let count = 0;
  for (const node of only.nodes) {
    if (node.kind === "emoji") {
      count += 1;
    } else if (node.kind !== "text" || !EMOJI_ONLY.test(node.text)) {
      return false;
    } else {
      count += graphemes(node.text).filter((piece) => piece.trim().length > 0).length;
    }
  }
  return count > 0 && count <= JUMBO_MAX;
}
