import type { ComponentProps } from "react";

import { cx } from "../cx";
import { Slot } from "../internal/slot";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "danger-solid";
export type ButtonSize = "default" | "sm" | "icon" | "icon-sm";

export interface ButtonProps extends ComponentProps<"button"> {
  /**
   * `primary` is the accent fill for the one action a view leads to.
   * `secondary` is the outlined answer beside it, and with `aria-pressed` a
   * toggle. `quiet` has no border. `danger` outlines a destructive action and
   * `danger-solid` fills the one that confirms it.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Draws the one child element, such as an `<a>`, as the button instead. */
  asChild?: boolean;
}

export function Button({ className, variant = "primary", size = "default", asChild = false, ...props }: ButtonProps) {
  const shared = { className: cx("ui-button", className), "data-variant": variant, "data-size": size };
  return asChild ? <Slot {...shared} {...props} /> : <button {...shared} {...props} />;
}
