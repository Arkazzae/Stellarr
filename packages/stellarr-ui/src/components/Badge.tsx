import type { ComponentProps } from "react";

import { cx } from "../cx";

export type BadgeVariant = "secondary" | "outline" | "success" | "warning" | "destructive";

export interface BadgeProps extends ComponentProps<"span"> {
  /** The word carries the meaning; the colour only repeats it. */
  variant: BadgeVariant;
}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cx("ui-badge", className)} data-variant={variant} {...props} />;
}
