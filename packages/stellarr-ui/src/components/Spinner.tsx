import { cx } from "../cx";

/**
 * Work in progress: the open ring of Stellarr's icon set, turning. The 24 px
 * box is for a spinner standing alone; inside a button the button sizes it,
 * and a `size-*` class sizes it anywhere else.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      className={cx("ui-spinner", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M21.4 10.5A9.5 9.5 0 1 1 16.8 3.8"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
