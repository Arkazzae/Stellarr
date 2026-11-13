"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/hooks";

import {
  CODE_LANGUAGES,
  codeLanguageLabel,
  resolveCodeLanguage,
  tokenizeCode,
  type CodeLanguageId,
  type CodeToken,
} from "../codeLanguages";
import type { CodePart } from "../parts";

export interface CodeAttachmentProps {
  part: CodePart;
  onCopy?(part: CodePart): void;
}

/** A listing longer than this starts collapsed, with a control to open it. */
const COLLAPSED_LINES = 16;
/** How long the copy button shows its outcome before going back to "copy". */
const COPY_FEEDBACK_MS = 1600;

type CopyState = "idle" | "copied" | "error";
type Run = Pick<CodeToken, "kind" | "text">;

/** Cuts the highlighted runs at line breaks, each piece keeping its own class. */
function splitLines(tokens: readonly CodeToken[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const token of tokens) {
    const pieces = token.text.split("\n");
    pieces.forEach((text, index) => {
      if (index > 0) lines.push([]);
      if (text.length > 0) lines.at(-1)?.push({ kind: token.kind, text });
    });
  }
  return lines;
}

export function CodeAttachment({ part, onCopy }: CodeAttachmentProps) {
  const { t } = useLanguage();
  const contentId = useId();
  const source = part.source ?? part.tokens.map((token) => token.text).join("");
  const initialLanguage = part.language ?? resolveCodeLanguage(part.lang, source);
  const [language, setLanguage] = useState<CodeLanguageId>(initialLanguage);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const lineCount = source.length === 0 ? 0 : source.split("\n").length;
  const collapsible = lineCount > COLLAPSED_LINES;
  const languageName = language === "plaintext" ? t("code.plaintext") : codeLanguageLabel(language);

  // The tokens that arrived with the part are only valid for the language they
  // were made in; any other choice is highlighted here.
  const tokens = useMemo(
    () =>
      language === initialLanguage && part.tokens.length > 0
        ? part.tokens
        : tokenizeCode(source, language),
    [initialLanguage, language, part.tokens, source],
  );
  const lines = useMemo(() => splitLines(tokens), [tokens]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copy = async () => {
    try {
      if (onCopy === undefined) await navigator.clipboard.writeText(source);
      else onCopy({ ...part, source, language, tokens });
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const copyLabel =
    copyState === "copied"
      ? t("attachment.codeCopied")
      : copyState === "error"
        ? t("attachment.retryCodeCopy")
        : t("attachment.copyCode");

  return (
    <div className="att att-window att-code">
      <div className="code-head">
        <div className="code-meta">
          <label>
            <span className="sr-only">{t("attachment.highlightLanguage")}</span>
            <select
              value={language}
              aria-label={t("attachment.highlightLanguage")}
              title={t("attachment.changeHighlightLanguage")}
              onChange={(event) => setLanguage(event.target.value as CodeLanguageId)}
            >
              {CODE_LANGUAGES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id === "plaintext" ? t("code.plaintext") : entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="code-actions">
          {collapsible ? (
            <>
              <span>{t("attachment.codeLines", { count: lineCount })}</span>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? t("attachment.collapse") : t("attachment.expand")}
              </button>
            </>
          ) : null}
          <Button
            type="button"
            variant="quiet"
            size="icon-sm"
            className={copyState === "error" ? "code-copy copy-error" : "code-copy"}
            aria-label={copyLabel}
            title={copyLabel}
            onClick={() => void copy()}
          >
            <Icon name={copyState === "copied" ? "tick" : "copy"} size={15} />
          </Button>
        </div>
      </div>
      <pre
        id={contentId}
        className={collapsible ? (expanded ? "expanded" : "compact") : undefined}
        aria-label={t("attachment.codeLabel", { language: languageName })}
        // Scrollable, so a keyboard user must be able to focus it.
        tabIndex={0}
      >
        <code data-language={language}>
          {lines.map((line, lineIndex) => (
            <span className="code-line" key={lineIndex}>
              {line.map((run, runIndex) =>
                run.kind === "text" ? (
                  run.text
                ) : (
                  <span key={runIndex} className={run.kind}>
                    {run.text}
                  </span>
                ),
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
