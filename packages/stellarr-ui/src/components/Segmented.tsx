"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "../cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** A muted second line next to the label, such as "1080p · 30 fps". */
  detail?: string;
  /** Rendered before the label, such as a colour swatch. */
  leading?: ReactNode;
  /**
   * The long version of a short label. It is a tooltip and nothing else, so
   * whatever it says has to be readable some other way too: touch has no hover.
   */
  title?: string;
  /**
   * Published as `data-tone` so CSS can colour the selected segment by meaning
   * rather than by position: a permission's "deny" is red wherever it sits.
   */
  tone?: string;
}

/**
 * `cards` is a grid of bordered cards, each with room for a second line.
 * `pill` is one compact row inside a rounded track, for short words.
 */
export type SegmentedVariant = "cards" | "pill";

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group; the control has no visible heading of its own. */
  label: string;
  variant?: SegmentedVariant;
  disabled?: boolean;
  className?: string;
}

/** The option an arrow, Home or End key leads to, or null for any other key. */
function targetIndex(key: string, from: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * A row of mutually exclusive choices, as a radio group.
 *
 * It follows the native pattern: one tab stop for the whole group, and the
 * arrow keys move focus and select in the same step, which is what screen
 * reader users expect once the buttons announce themselves as radios.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = "cards",
  disabled,
  className,
}: SegmentedProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((option) => option.value === value);
  // With nothing selected the group still needs exactly one tab stop.
  const tabStop = Math.max(selected, 0);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const to = targetIndex(event.key, from, options.length);
    const option = to === null ? undefined : options[to];
    if (to === null || option === undefined) return;
    event.preventDefault();
    buttons.current[to]?.focus();
    onChange(option.value);
  };

  return (
    <div
      className={cx("ui-segmented", className)}
      role="radiogroup"
      aria-label={label}
      data-variant={variant}
    >
      {options.map((option, index) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            className="ui-segmented-item"
            aria-checked={on}
            data-state={on ? "checked" : "unchecked"}
            data-tone={option.tone}
            title={option.title}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.leading}
            {option.label}
            {option.detail ? <span className="ui-segmented-detail">{option.detail}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
