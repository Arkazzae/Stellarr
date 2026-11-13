import type { ComponentProps } from "react";

import { cx } from "../cx";
import { Slot } from "../internal/slot";

export type ButtonVariant = "default" | "destructive" | "outline" | "ghost";
export type ButtonSize = "default" | "sm" | "icon" | "icon-sm";

export interface ButtonProps extends ComponentProps<"button"> {
  /**
   * `default` is the accent fill for the one action a view leads to. An
   * `outline` button with `aria-pressed` is a toggle: muted while off, washed
   * while on.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Draws the one child element, such as an `<a>`, as the button instead. */
  asChild?: boolean;
}

export function Button({ className, variant = "default", size = "default", asChild = false, ...props }: ButtonProps) {
  const shared = { className: cx("ui-button", className), "data-variant": variant, "data-size": size };
  return asChild ? <Slot {...shared} {...props} /> : <button {...shared} {...props} />;
}
