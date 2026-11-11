import { COCKPIT_ICON_PATHS } from "./cockpit-paths";
import { ICON_PATHS, type IconPath } from "./paths";

const PATHS: Record<IconName, readonly IconPath[]> = { ...ICON_PATHS, ...COCKPIT_ICON_PATHS };

export type IconName = keyof typeof ICON_PATHS | keyof typeof COCKPIT_ICON_PATHS;

interface IconProps {
  name: IconName;
  /** Side of the square box in pixels. */
  size?: number;
  className?: string;
}

const DEFAULT_STROKE_WIDTH = 1.5;

/**
 * The web client's icon set (paths.ts, copied unchanged from
 * web/src/components/icons) and the few Cockpit adds (cockpit-paths.ts). Icons are decorative: the control that holds one
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
      {PATHS[name].map((path, index) => (
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
