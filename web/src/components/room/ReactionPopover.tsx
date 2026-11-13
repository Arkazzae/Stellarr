"use client";

import { useRef, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useLayer } from "@stellarr/ui/behavior";

import type { EmojiEntry } from "@/lib/emoji";
import type { CustomEmoji } from "@/ports";

import { EmojiPicker } from "./EmojiPicker";

/**
 * Below this many pixels of room underneath, the popover opens upwards.
 *
 * It belongs to a message that can be anywhere in the transcript, and a panel
 * that opens downwards off the last message would be a panel you cannot see.
 * Measured against the viewport rather than the scroller because the panel is
 * what has to fit on screen.
 */
const ROOM_BELOW = 460;

/** The least room left between the popover and the edge of the viewport. */
const EDGE = 8;

/** Between the anchor and the popover. */
const GAP = 6;

export interface PopoverPlacement {
  up: boolean;
  style: CSSProperties;
}

/** Right-aligned under the anchor, or over it when the bottom edge is close. */
export function placeReactionPopover(anchor: DOMRect): PopoverPlacement {
  const right = Math.max(EDGE, window.innerWidth - anchor.right);
  if (window.innerHeight - anchor.bottom < ROOM_BELOW) {
    return {
      up: true,
      style: { right, bottom: Math.max(EDGE, window.innerHeight - anchor.top + GAP) },
    };
  }
  return { up: false, style: { right, top: anchor.bottom + GAP } };
}

/** What a reaction is stored as: the character, or `:shortcode:` for a server emoji. */
function reactionFor(entry: EmojiEntry): string {
  return entry.imageUrl === undefined ? entry.glyph : `:${entry.shortcode}:`;
}

export interface ReactionPopoverProps {
  placement: PopoverPlacement;
  label: string;
  /** False for a touch-opened popover, so browsing does not raise the keyboard. */
  autoFocus: boolean;
  /** The server's own emoji, offered first. */
  customEmoji: readonly CustomEmoji[];
  /** Controls that open and close the popover themselves; pressing one is not "outside". */
  triggers: readonly RefObject<HTMLElement | null>[];
  onPick(reaction: string): void;
  /** `restoreFocus` is true when the keyboard asked for the close. */
  onClose(restoreFocus: boolean): void;
}

/**
 * The emoji picker as a floating dialog for choosing one reaction. Mounted only
 * while open, which is also when it is a layer on the shared stack: Escape and
 * a press outside close it when no layer above it takes them.
 */
export function ReactionPopover({
  placement,
  label,
  autoFocus,
  customEmoji,
  triggers,
  onPick,
  onClose,
}: ReactionPopoverProps) {
  const panel = useRef<HTMLDivElement>(null);

  useLayer(true, {
    node: () => panel.current,
    // The picker itself is the inside. The panel around it is not: on a phone
    // it is the clear layer behind the sheet, and pressing it dismisses.
    owns: (target) =>
      panel.current?.querySelector(".emo-pick")?.contains(target) === true ||
      triggers.some((trigger) => trigger.current?.contains(target) === true),
    onEscape: () => {
      onClose(true);
    },
    onPointerDownOutside: () => {
      onClose(false);
    },
  });

  return createPortal(
    <div
      ref={panel}
      className={placement.up ? "emo-pop-react portaled up" : "emo-pop-react portaled"}
      role="dialog"
      aria-label={label}
      style={placement.style}
    >
      <EmojiPicker
        customEmoji={customEmoji}
        autoFocus={autoFocus}
        onPick={(entry) => onPick(reactionFor(entry))}
        onClose={() => onClose(true)}
      />
    </div>,
    document.body,
  );
}
