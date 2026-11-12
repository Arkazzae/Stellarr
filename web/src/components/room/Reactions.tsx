"use client";

import { useEffect, useRef, useState } from "react";

import type { CustomEmoji, Reaction } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** Matches the `reactPop` animation in transcript.css. */
const POP_MS = 240;

const bare = (shortcode: string) => shortcode.replace(/^:|:$/g, "");

export interface ReactionsProps {
  reactions: Reaction[];
  /** Toggles this user's reaction. Without it the chips are inert. */
  onToggle?(emoji: string): void;
  /** Resolves a reaction stored as `:shortcode:` to its image. */
  customEmoji?: readonly CustomEmoji[];
}

/** The chips under a message: one per emoji, with its count and whether it is yours. */
export function Reactions({
  reactions,
  onToggle,
  customEmoji = [],
}: ReactionsProps) {
  const { t } = useLanguage();
  const [popping, setPopping] = useState<ReadonlySet<string>>(new Set());
  const counts = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    const before = counts.current;
    counts.current = new Map(reactions.map(({ emoji, count }) => [emoji, count]));
    // Chips already there when the message first rendered do not animate; only
    // one whose count has just changed does.
    if (before === null) return;

    const changed = reactions
      .filter(({ emoji, count }) => before.get(emoji) !== count)
      .map(({ emoji }) => emoji);
    if (changed.length === 0) return;

    setPopping(new Set(changed));
    const timer = window.setTimeout(() => setPopping(new Set()), POP_MS);
    return () => window.clearTimeout(timer);
  }, [reactions]);

  if (reactions.length === 0) return null;

  return (
    <div className="reactions">
      {reactions.map(({ emoji, count, mine }) => {
        const image = customEmoji.find((item) => bare(item.shortcode) === bare(emoji));
        const classes = ["react-chip", mine && "mine", popping.has(emoji) && "pop"];
        return (
          <button
            key={emoji}
            type="button"
            className={classes.filter(Boolean).join(" ")}
            data-emo={emoji}
            aria-pressed={mine}
            aria-label={t("message.reactionCount", { emoji, count })}
            onClick={onToggle && (() => onToggle(emoji))}
          >
            <span className="emo">
              {image === undefined ? (
                emoji
              ) : (
                <img
                  className="reaction-emoji"
                  src={image.glyph}
                  alt={emoji}
                  width={16}
                  height={16}
                />
              )}
            </span>
            {count}
          </button>
        );
      })}
    </div>
  );
}
