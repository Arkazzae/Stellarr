import { cn } from "@/lib/utils";

/**
 * Animated loading spinner. Uses the open ring glyph from Stellarr's own icon
 * set, drawn on a 24×24 canvas at a 1.5 px stroke width. The 24 px default box
 * is the one Lucide's spinner had; a few pages show it outside a button, where
 * nothing else sizes it.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      className={cn("animate-spin", className)}
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
