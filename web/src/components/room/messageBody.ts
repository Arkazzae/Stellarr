/**
 * The parts a message's own text turns into: prose, and fenced code blocks.
 *
 * Fences arrive inside `content` because `Attachment` has no code kind: a paste
 * is text, not a file.
 */

import { resolveCodeLanguage, tokenizeCode } from "./codeLanguages";
import { inlineText, parseInline, type InlineNode, type ParseInlineOptions } from "./inline";
import type { MessagePart } from "./partTypes";

/**
 * A fence is ```<info> on its own line, up to a closing ``` on its own line.
 * The info string is a lexer alias or, as in the mockup, a file name.
 */
const FENCE = /^```(.*)\n([\s\S]*?)\n?^```[ \t]*$/gm;

/** Splits a body into its prose and its fenced blocks, in order. */
function textAndCodeParts(content: string, options: ParseInlineOptions): MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;

  const prose = (raw: string): void => {
    const text = raw.trim();
    if (text.length > 0) parts.push({ kind: "text", nodes: parseInline(text, options) });
  };

  for (const match of content.matchAll(FENCE)) {
    prose(content.slice(cursor, match.index));
    const authored = (match[1] ?? "").trim();
    const source = match[2] ?? "";
    const language = resolveCodeLanguage(authored, source);
    parts.push({
      kind: "code",
      lang: language === "plaintext" ? "" : authored,
      source,
      language,
      tokens: tokenizeCode(source, language),
    });
    cursor = match.index + match[0].length;
  }
  prose(content.slice(cursor));
  return parts;
}

/**
 * Joins the text on either side of a link that was just taken out. Spaces and
 * tabs around the gap collapse into one; line breaks are left alone.
 */
function closeGap(kept: InlineNode[], text: string): void {
  const previous = kept.at(-1);
  if (previous?.kind !== "text") {
    const tail = text.replace(/^[ \t]+/, "");
    if (tail.length > 0) kept.push({ kind: "text", text: tail });
    return;
  }

  const spaced = /[ \t]$/.test(previous.text) || /^[ \t]/.test(text);
  previous.text = previous.text.replace(/[ \t]+$/, "");
  const tail = text.replace(/^[ \t]+/, "");
  previous.text += spaced && previous.text.length > 0 && tail.length > 0 ? ` ${tail}` : tail;
}

/** The nodes without the links in `urls`, and without what that leaves empty. */
function withoutLinks(nodes: readonly InlineNode[], urls: ReadonlySet<string>): InlineNode[] {
  const kept: InlineNode[] = [];
  let afterGap = false;

  for (const original of nodes) {
    let node = original;
    if ("children" in node && node.children) {
      const children = withoutLinks(node.children, urls);
      if (children.length === 0) {
        afterGap = true;
        continue;
      }
      node = { ...node, children, text: inlineText(children) };
    }
    if (node.kind === "link" && urls.has(node.href)) {
      afterGap = true;
      continue;
    }

    if (node.kind === "text" && afterGap) closeGap(kept, node.text);
    else kept.push({ ...node });
    afterGap = false;
  }

  const last = kept.at(-1);
  if (afterGap && last?.kind === "text") last.text = last.text.trimEnd();
  return kept.filter((node) => node.kind !== "text" || node.text.length > 0);
}

/**
 * A URL is hidden only when a real card or player for that exact URL is
 * rendered next to the text. The authored content is untouched; this is
 * presentation, the same as swapping the URL for its preview.
 */
function withoutPreviewedLinks(parts: MessagePart[], previewed: ReadonlySet<string>): MessagePart[] {
  if (previewed.size === 0) return parts;
  return parts.flatMap((part): MessagePart[] => {
    if (part.kind !== "text") return [part];
    const nodes = withoutLinks(part.nodes, previewed);
    return nodes.length === 0 ? [] : [{ kind: "text", nodes }];
  });
}

/** The prose and code blocks of `content`, minus links that have a preview of their own. */
export function bodyParts(
  content: string,
  options: ParseInlineOptions,
  previewedUrls: ReadonlySet<string>,
): MessagePart[] {
  return withoutPreviewedLinks(textAndCodeParts(content, options), previewedUrls);
}
