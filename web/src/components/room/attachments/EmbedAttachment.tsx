"use client";

import type { KeyboardEvent } from "react";

import type { EmbedPart } from "../parts";

export interface EmbedAttachmentProps {
  part: EmbedPart;
  onOpen?(part: EmbedPart): void;
}

export function EmbedAttachment({ part, onOpen }: EmbedAttachmentProps) {
  const open = onOpen && (() => onOpen(part));

  // A link role comes with the keyboard contract of a link.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open === undefined || event.key !== "Enter") return;
    event.preventDefault();
    open();
  };

  return (
    <div
      className={part.thumb === undefined ? "att att-embed" : "att att-embed rich"}
      role="link"
      tabIndex={0}
      // The card stands in for a URL no longer written out in the body, so it
      // has to say where it leads.
      aria-label={`${part.title} — ${part.domain}`}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      {/* The server copied the thumbnail when it unfurled the link, so opening
          a channel never calls out to whoever wrote the page. */}
      {part.thumb === undefined ? null : (
        <img className="emb-thumb" src={part.thumb} alt="" loading="lazy" />
      )}
      <div className="emb-text">
        <span className="dom">{part.domain}</span>
        <b>{part.title}</b>
        {part.description === "" ? null : <p>{part.description}</p>}
      </div>
    </div>
  );
}
