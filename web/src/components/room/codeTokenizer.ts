/**
 * The lexers behind syntax highlighting.
 *
 * Deliberately small: a wrong language choice may colour the wrong word, but
 * the tokens always concatenate back to the exact source, and each one carries
 * literal text that React escapes when it is drawn.
 */

import type { CodeLanguageId, CodeToken, CodeTokenKind } from "./codeLanguages";
import { SYNTAX, type LanguageSyntax } from "./codeSyntax";

type GroupKinds = Readonly<Record<string, CodeTokenKind>>;

/** Adds a run to the end, folding it into the previous one of the same kind. */
function append(tokens: CodeToken[], kind: CodeTokenKind, text: string): void {
  if (text.length === 0) return;
  const last = tokens.at(-1);
  if (last?.kind === kind) last.text += text;
  else tokens.push({ kind, text });
}

/** The kind of whichever named group took part in the match. */
function kindOfGroup(match: RegExpExecArray, kinds: GroupKinds): CodeTokenKind | undefined {
  for (const [name, text] of Object.entries(match.groups ?? {})) {
    if (text !== undefined) return kinds[name];
  }
  return undefined;
}

/**
 * Walks the matches of a global pattern. A match the classifier declines is not
 * coloured and stays part of the surrounding plain text.
 */
function scan(
  source: string,
  pattern: RegExp,
  classify: (match: RegExpExecArray) => CodeTokenKind | undefined,
): CodeToken[] {
  const tokens: CodeToken[] = [];
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const kind = classify(match);
    if (kind === undefined) continue;
    append(tokens, "text", source.slice(cursor, match.index));
    append(tokens, kind, match[0]);
    cursor = match.index + match[0].length;
  }
  append(tokens, "text", source.slice(cursor));
  return tokens;
}

/* ------------------------------------------------------------- markup, css */

const MARKUP_PATTERN =
  /(?<cm><!--[\s\S]*?-->)|(?<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<tag><\/?[A-Za-z][\w:.-]*|\/?>)|(?<attr>[A-Za-z_:][\w:.-]*(?=\s*=))|(?<entity>&(?:#\d+|#x[\da-f]+|\w+);)|(?<num>-?\b\d+(?:\.\d+)?\b)/gi;
const MARKUP_KINDS: GroupKinds = {
  cm: "cm",
  str: "str",
  entity: "str",
  tag: "tag",
  attr: "attr",
  num: "num",
};

const CSS_PATTERN =
  /(?<cm>\/\*[\s\S]*?\*\/)|(?<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<hex>#[\da-f]{3,8}\b)|(?<kw>@[\w-]+)|(?<attr>--?[A-Za-z_][\w-]*|[A-Za-z_][\w-]*(?=\s*:))|(?<num>-?(?:\d*\.)?\d+(?:%|[a-z]+)?\b)|(?<fn>[A-Za-z_-][\w-]*(?=\())/gi;
const CSS_KINDS: GroupKinds = {
  cm: "cm",
  str: "str",
  hex: "str",
  kw: "kw",
  attr: "attr",
  num: "num",
  fn: "fn",
};

/* ----------------------------------------------------------------- generic */

const GENERIC_KINDS: GroupKinds = { cm: "cm", str: "str", num: "num", attr: "attr" };

/** Where a call would start: the word just read is followed by `(`. */
const CALL_OPENS = /\s*\(/y;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordSet(list: string | undefined, insensitive: boolean): ReadonlySet<string> {
  const words = (list ?? "").split(/\s+/).filter(Boolean);
  return new Set(insensitive ? words.map((word) => word.toLowerCase()) : words);
}

function genericPattern(syntax: LanguageSyntax): RegExp {
  const comments = [
    ...(syntax.blockComments ?? []).map(
      ([open, close]) => `${escapeRegExp(open)}[\\s\\S]*?${escapeRegExp(close)}`,
    ),
    ...(syntax.lineComments ?? []).map((open) => `${escapeRegExp(open)}[^\\n]*`),
  ];
  const strings = [
    ...(syntax.tripleStrings ? ['"""[\\s\\S]*?"""', "'''[\\s\\S]*?'''"] : []),
    ...(syntax.backticks ? ["`(?:[^`\\\\]|\\\\[\\s\\S])*`"] : []),
    '"(?:[^"\\\\\\n]|\\\\.)*"',
    "'(?:[^'\\\\\\n]|\\\\.)*'",
  ];
  const alternatives = [
    ...(comments.length > 0 ? [`(?<cm>${comments.join("|")})`] : []),
    `(?<str>${strings.join("|")})`,
    "(?<num>-?\\b(?:0x[\\da-f]+|0b[01]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)",
    ...(syntax.properties ? ["(?<attr>[A-Za-z_][\\w.-]*(?=\\s*:))"] : []),
    "(?<word>[A-Za-z_$][\\w$-]*)",
  ];
  return new RegExp(alternatives.join("|"), syntax.caseInsensitive ? "gi" : "g");
}

function tokenizeGeneric(source: string, syntax: LanguageSyntax): CodeToken[] {
  const insensitive = syntax.caseInsensitive === true;
  const keywords = wordSet(syntax.keywords, insensitive);
  // Library names and types are coloured alike.
  const types = new Set([
    ...wordSet(syntax.types, insensitive),
    ...wordSet(syntax.builtins, insensitive),
  ]);

  return scan(source, genericPattern(syntax), (match) => {
    const word = match.groups?.word;
    if (word === undefined) return kindOfGroup(match, GENERIC_KINDS);

    const key = insensitive ? word.toLowerCase() : word;
    if (keywords.has(key)) return "kw";
    if (types.has(key)) return "type";
    CALL_OPENS.lastIndex = match.index + word.length;
    return CALL_OPENS.test(source) ? "fn" : undefined;
  });
}

/* ------------------------------------------------------------------ public */

/** Tokenises with the selected language; the result always spells the source. */
export function tokenizeCode(
  source: string,
  language: CodeLanguageId = "typescript",
): CodeToken[] {
  if (source.length === 0) return [];
  if (language === "html") return scan(source, MARKUP_PATTERN, (m) => kindOfGroup(m, MARKUP_KINDS));
  if (language === "css") return scan(source, CSS_PATTERN, (m) => kindOfGroup(m, CSS_KINDS));

  // Plain text, Markdown and anything without a vocabulary stay uncoloured.
  const syntax = SYNTAX[language];
  return syntax === undefined
    ? [{ kind: "text", text: source }]
    : tokenizeGeneric(source, syntax);
}
