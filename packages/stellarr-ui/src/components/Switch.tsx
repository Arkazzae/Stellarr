"use client";

import type { ComponentProps } from "react";

import { cx } from "../cx";
import { useControllableState } from "../internal/state";

export interface SwitchProps extends Omit<ComponentProps<"button">, "value" | "defaultChecked" | "onChange"> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * An on/off setting that applies at once. It draws no text: name it with a
 * `<label htmlFor>` or `aria-label`.
 */
export function Switch({ checked, defaultChecked = false, onCheckedChange, className, onClick, ...props }: SwitchProps) {
  const [on, setOn] = useControllableState({ value: checked, defaultValue: defaultChecked, onChange: onCheckedChange });
  const state = on ? "checked" : "unchecked";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      value="on"
      data-state={state}
      className={cx("ui-switch", className)}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOn(!on);
      }}
    >
      <span className="ui-switch-thumb" data-state={state} />
    </button>
  );
}
