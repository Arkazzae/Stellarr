"use client";

import type { ReactNode } from "react";

import { Icon } from "@stellarr/ui/icons";

export interface CollapsibleGroupProps {
  /** Id of the body; the caption button points at it with `aria-controls`. */
  id: string;
  caption: ReactNode;
  captionTitle?: string;
  open: boolean;
  onToggle: () => void;
  /** Controls beside the caption, such as the "+" that creates a channel. */
  actions?: ReactNode;
  /** Extra class on the caption row, for a section's own spacing. */
  className?: string;
  children: ReactNode;
}

/**
 * The caption and collapsible body shared by every rail group: text channels,
 * voice channels, and each section that wraps a pair of them.
 *
 * CSS collapses the body with `max-height`, which leaves its rows focusable,
 * so `inert` is what takes a closed group out of the tab order.
 */
export function CollapsibleGroup({
  id,
  caption,
  captionTitle,
  open,
  onToggle,
  actions,
  className,
  children,
}: CollapsibleGroupProps) {
  return (
    <>
      <div className={["rail-cap", className].filter(Boolean).join(" ")}>
        <button
          type="button"
          className="group-caption"
          aria-expanded={open}
          aria-controls={id}
          title={captionTitle}
          onClick={onToggle}
        >
          {caption}{" "}
          <span className="caret">
            <Icon name="caret" size={10} />
          </span>
        </button>
        {actions}
      </div>
      <div id={id} className={open ? "collapsible" : "collapsible closed"} inert={!open}>
        {children}
      </div>
    </>
  );
}
