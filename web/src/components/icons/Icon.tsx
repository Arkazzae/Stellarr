import { ICON_PATHS, type IconName } from "./paths";

export type { IconName } from "./paths";

export interface IconProps {
  name: IconName;
  /** Side of the square box in pixels; controls use 12 to 24. */
  size?: number;
  className?: string;
}

/** The control carries the accessible name; its glyph is decorative. */
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
          d={path}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
