"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { InterfaceLocale, Translator } from "@/i18n";

import type { InlineNode } from "../parts";

/** Eight lines show enough context without letting one message take the room. */
const COLLAPSED_LINES = 8;
/** Used before layout exists to measure: roughly what a line of the transcript holds. */
const CHARS_PER_LINE = 64;
const FALLBACK_LINE_HEIGHT = 24;

const WRAPPING_TAGS = { strong: "strong", emphasis: "em", strike: "del" } as const;

interface Rendering {
  locale: InterfaceLocale;
  t: Translator;
}

/** What the reader sees as characters; emoji count as their shortcode. */
function visibleText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "edited") return "";
      return node.kind === "emoji" ? `:${node.shortcode}:` : node.text;
    })
    .join("");
}

function estimateLines(nodes: readonly InlineNode[]): number {
  return visibleText(nodes)
    .split("\n")
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)),
      0,
    );
}

/** Hidden until the reader chooses to see it; a click or Enter reveals it for good. */
function Spoiler({ label, children }: { label: string; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) return <span className="msg-spoiler revealed">{children}</span>;

  return (
    <span
      className="msg-spoiler"
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(event) => {
        // The message row behind it may be clickable too.
        event.stopPropagation();
        setRevealed(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setRevealed(true);
      }}
    >
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

type FormattedNode = Extract<
  InlineNode,
  { kind: "strong" | "emphasis" | "strike" | "spoiler" }
>;

/** Nested formatting keeps its children; a flat run only has its text. */
function renderContent(node: FormattedNode, view: Rendering): ReactNode {
  return node.children === undefined ? node.text : renderNodes(node.children, view);
}

function renderNodes(nodes: readonly InlineNode[], view: Rendering): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
      case "emphasis":
      case "strike": {
        const Tag = WRAPPING_TAGS[node.kind];
        return <Tag key={index}>{renderContent(node, view)}</Tag>;
      }
      case "spoiler":
        return (
          <Spoiler key={index} label={view.t("message.spoiler")}>
            {renderContent(node, view)}
          </Spoiler>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="ugc nofollow noopener noreferrer"
            style={{ color: "var(--accent-text)" }}
          >
            {node.text}
          </a>
        );
      case "mention":
        return (
          <span
            key={index}
            className={node.self ? "msg-mention self" : "msg-mention"}
            title={node.displayName}
            data-user-id={node.userId}
          >
            {node.text}
          </span>
        );
      case "edited":
        return (
          <span
            key={index}
            className="msg-edited"
            title={view.t("message.editedAt", {
              date: new Date(node.at).toLocaleString(
                view.locale === "en" ? "en-GB" : "pl-PL",
              ),
            })}
          >
            {view.t("message.edited")}
          </span>
        );
      case "emoji": {
        const shortcode = `:${node.shortcode}:`;
        return (
          <img
            key={index}
            className="msg-emo"
            src={node.src}
            alt={shortcode}
            title={shortcode}
            loading="lazy"
            draggable={false}
          />
        );
      }
      case "text":
        return node.text;
    }
  });
}

export interface TextAttachmentProps extends Rendering {
  nodes: readonly InlineNode[];
}

export function TextAttachment({ nodes, locale, t }: TextAttachmentProps) {
  const contentId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // An estimate until the browser can say how tall the text really is, so a
  // long message does not flash open on its first paint.
  const [collapsible, setCollapsible] = useState(
    () => estimateLines(nodes) > COLLAPSED_LINES,
  );

  useLayoutEffect(() => {
    const element = content.current;
    if (element === null) return;

    const measure = () => {
      // No layout (hidden, or not yet attached) reports a height of zero.
      if (element.scrollHeight === 0) return;
      const lineHeight = Number.parseFloat(
        window.getComputedStyle(element).lineHeight,
      );
      const height = Number.isFinite(lineHeight) ? lineHeight : FALLBACK_LINE_HEIGHT;
      setCollapsible(element.scrollHeight > height * COLLAPSED_LINES + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [nodes]);

  return (
    <div className="msg-long-text">
      <div
        id={contentId}
        ref={content}
        className={
          collapsible && !expanded
            ? "msg-text-content collapsed"
            : "msg-text-content"
        }
      >
        {renderNodes(nodes, { locale, t })}
      </div>
      {collapsible ? (
        <button
          type="button"
          className="msg-long-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t("message.showLess") : t("message.showMore")}
        </button>
      ) : null}
    </div>
  );
}
