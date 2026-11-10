/**
 * The application mark: a speech bubble holding the three-bar level meter that
 * the roster shows for someone speaking, so text and voice share one glyph.
 *
 * The bubble takes `currentColor` and the meter takes `--accent`, which lets the
 * lockup follow the palette and the personal accent without naming a colour.
 */
export function StellarrMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden={true}
      focusable="false"
    >
      <path
        d="M20 10H44A12 12 0 0 1 56 22V34A12 12 0 0 1 44 46H34L22 56V46H20A12 12 0 0 1 8 34V22A12 12 0 0 1 20 10Z"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <g fill="var(--accent)">
        <rect x="21" y="22" width="6" height="12" rx="3" />
        <rect x="29" y="18" width="6" height="20" rx="3" />
        <rect x="37" y="20.5" width="6" height="15" rx="3" />
      </g>
    </svg>
  );
}
