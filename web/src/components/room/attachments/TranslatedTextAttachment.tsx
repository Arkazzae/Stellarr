"use client";

import { useMemo, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { type InterfaceLocale, type TranslationTargetLanguage, type Translator } from "@/i18n";
import { documentLocale, translateForDocument } from "@/i18n/defaultLocale";
import { useTranslatedContent } from "@/lib/chatTranslation/useTranslatedContent";

import {
  inlineDescendants,
  parseInline,
  type InlineNode,
  type MentionTarget,
} from "../parts";

import { TextAttachment } from "./TextAttachment";

export interface MessageTranslationOptions {
  locale: InterfaceLocale;
  enabled: boolean;
  autoTranslate: boolean;
  targetLanguage: TranslationTargetLanguage;
  t: Translator;
}

export interface TranslatedTextAttachmentProps {
  nodes: readonly InlineNode[];
  translation?: MessageTranslationOptions;
  /** New messages jump ahead of older visible rows in the translation queue. */
  priority?: boolean;
}

const WRAPPERS = { strong: "**", emphasis: "*", strike: "~~", spoiler: "||" } as const;

/**
 * The text the translator is given: the formatting is written back as markup so
 * it survives the round trip, and the translation is parsed again afterwards.
 */
function sourceText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "code":
          return `\`${node.text}\``;
        case "strong":
        case "emphasis":
        case "strike":
        case "spoiler": {
          // A bold run without children came from the system notices' `<b>`.
          if (node.kind === "strong" && node.children === undefined) {
            return `<b>${node.text}</b>`;
          }
          const inner = node.children === undefined ? node.text : sourceText(node.children);
          return `${WRAPPERS[node.kind]}${inner}${WRAPPERS[node.kind]}`;
        }
        case "emoji":
          return `:${node.shortcode}:`;
        case "edited":
          return "";
        default:
          return node.text;
      }
    })
    .join("");
}

/** Two letters in a row once links are removed; numbers and emoji alone are left as they are. */
function isTranslatable(text: string): boolean {
  return /\p{L}{2}/u.test(text.replace(/https?:\/\/\S+/g, ""));
}

/**
 * Parses the translation with the mentions and emoji of the original, so they
 * stay resolved, and keeps the "(edited)" mark the translator never saw.
 */
function translatedNodesOf(
  nodes: readonly InlineNode[],
  translated: string,
): InlineNode[] {
  const descendants = inlineDescendants(nodes);
  const emoji = new Map<string, string>();
  const mentions = new Map<string, MentionTarget>();
  for (const node of descendants) {
    if (node.kind === "emoji") emoji.set(node.shortcode, node.src);
    if (node.kind === "mention") {
      mentions.set(node.username.toLocaleLowerCase(), {
        userId: node.userId,
        username: node.username,
        displayName: node.displayName,
        self: node.self,
      });
    }
  }

  const parsed = parseInline(translated, {
    strong: nodes.some((node) => node.kind === "strong"),
    ...(emoji.size > 0 ? { emoji } : {}),
    ...(mentions.size > 0 ? { mentions } : {}),
  });
  const edit = nodes.find((node) => node.kind === "edited");
  return edit === undefined ? parsed : [...parsed, edit];
}

export function TranslatedTextAttachment({
  nodes,
  translation,
  priority = false,
}: TranslatedTextAttachmentProps) {
  const enabled = translation?.enabled === true;
  const autoTranslate = translation?.autoTranslate === true;
  const targetLanguage = translation?.targetLanguage ?? "en";
  const locale = translation?.locale ?? documentLocale();
  const t = translation?.t ?? translateForDocument;

  const [requested, setRequested] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);

  const source = useMemo(() => sourceText(nodes), [nodes]);
  const translatable = isTranslatable(source);
  const trigger = enabled && translatable && (autoTranslate || requested);
  const { translatedContent, loading, error } = useTranslatedContent(
    source,
    targetLanguage,
    { trigger, priority, retryKey },
  );

  const differs = translatedContent !== null && translatedContent !== source;
  const translatedNodes = useMemo(
    () => (differs ? translatedNodesOf(nodes, translatedContent) : nodes),
    [differs, nodes, translatedContent],
  );

  if (!enabled || !translatable) {
    return <TextAttachment nodes={nodes} locale={locale} t={t} />;
  }

  const translatedVisible = trigger && differs && !showOriginal;
  // A translation identical to the source means the text was already in the
  // target language: there is nothing to toggle.
  const alreadyInTarget = trigger && translatedContent === source && error === null;

  const toggle = () => {
    if (!trigger) {
      setRequested(true);
      setShowOriginal(false);
    } else if (!differs && error !== null) {
      setRetryKey((current) => current + 1);
    } else {
      setShowOriginal((current) => !current);
    }
  };

  return (
    <div className="msg-translation">
      <TextAttachment
        nodes={translatedVisible ? translatedNodes : nodes}
        locale={locale}
        t={t}
      />
      <div className="msg-translation-foot">
        {loading ? (
          <span className="msg-translation-state" role="status">
            <Icon name="sparkle" size={12} />
            {t("message.translation.translating")}
          </span>
        ) : null}
        {error === null ? null : (
          <span className="msg-translation-error" role="alert">
            {t("message.translation.failed")}
          </span>
        )}
        {loading || alreadyInTarget ? null : (
          <button type="button" className="msg-translation-toggle" onClick={toggle}>
            <Icon name="sparkle" size={12} />
            {!trigger
              ? t("message.translation.translate")
              : translatedVisible
                ? t("message.translation.showOriginal")
                : t("message.translation.showTranslation")}
          </button>
        )}
      </div>
    </div>
  );
}
