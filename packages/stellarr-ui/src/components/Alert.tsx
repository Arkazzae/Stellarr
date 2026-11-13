import type { ComponentProps } from "react";

import { cx } from "../cx";

export interface AlertProps extends ComponentProps<"div"> {
  variant?: "default" | "destructive";
}

/** A message that stays where it applies until what it reports changes. */
export function Alert({ className, variant = "default", ...props }: AlertProps) {
  return <div role="alert" className={cx("ui-alert", className)} data-variant={variant} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-alert-title", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-alert-description", className)} {...props} />;
}
