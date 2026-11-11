import { COCKPIT_ICON_PATHS } from "./cockpit-paths";
import { ICON_PATHS, type IconPath } from "./paths";

const PATHS: Record<IconName, readonly IconPath[]> = { ...ICON_PATHS, ...COCKPIT_ICON_PATHS };

export type IconName = keyof typeof ICON_PATHS | keyof typeof COCKPIT_ICON_PATHS;

interface IconProps {
  name: IconName;
  /** Side of the square box in pixels at the default font size; drawn in rem, so it scales with the panel. */
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
  // In rem, so icons follow the panel's scale (index.css) with the text around them.
  const side = `${size / 16}rem`;
  return (
    <svg
      style={{ width: side, height: side }}
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
