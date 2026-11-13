import type { ComponentProps } from "react";

import { cx } from "../cx";

/** A one-line text field. `aria-invalid` draws it as refused. */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx("ui-input", className)} {...props} />;
}

/** A field's visible name; tie it to the field with `htmlFor`. */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cx("ui-label", className)} {...props} />;
}
