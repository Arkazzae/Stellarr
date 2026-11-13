import type { ComponentProps } from "react";

import { cx } from "../cx";

export interface TableProps extends ComponentProps<"table"> {
  /**
   * Classes for the wrapper that scrolls a wide table sideways. Pass
   * `overflow-visible` when a scroll area around the table scrolls it, so the
   * sticky header sticks to that area.
   */
  containerClassName?: string;
}

export function Table({ className, containerClassName, ...props }: TableProps) {
  return (
    <div className={cx("ui-table-container", containerClassName)}>
      <table className={cx("ui-table", className)} {...props} />
    </div>
  );
}

/** Sticks to the top of the area that scrolls the table. */
export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cx("ui-table-header", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cx("ui-table-body", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cx("ui-table-row", className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th className={cx("ui-table-head", className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cx("ui-table-cell", className)} {...props} />;
}
