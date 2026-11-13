import type { ComponentProps } from "react";

import { cx } from "../cx";

/** A surface a step off the page, holding one subject. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-card-header", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-card-title", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-card-description", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-card-content", className)} {...props} />;
}
