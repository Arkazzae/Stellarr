import { ICON_PATHS, type IconName } from "./paths";

export type { IconName };

interface IconProps {
  name: IconName;
  /** Side of the square box in pixels. */
  size?: number;
  className?: string;
}

const DEFAULT_STROKE_WIDTH = 1.5;

/**
 * The web client's icon set (paths.ts, copied unchanged from
 * web/src/components/icons). Icons are decorative: the control that holds one
 * carries the accessible name, so the glyph stays hidden from assistive tech.
 */
export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name].map((path, index) => (
        <path
          key={index}
          d={typeof path === "string" ? path : path.d}
          stroke="currentColor"
          strokeWidth={typeof path === "string" ? DEFAULT_STROKE_WIDTH : path.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
