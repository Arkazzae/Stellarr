import { NOISE_IMAGES } from "./noiseImages";
import { ICON_PATHS, type IconName as PathIconName } from "./paths";

type NoiseIconName = keyof typeof NOISE_IMAGES;

export type IconName = PathIconName | NoiseIconName;

export interface IconProps {
  name: IconName;
  /** Side of the square box in pixels; controls use 12 to 24. */
  size?: number;
  className?: string;
}

const DEFAULT_STROKE_WIDTH = 1.5;

function isNoiseIcon(name: IconName): name is NoiseIconName {
  return Object.hasOwn(NOISE_IMAGES, name);
}

/**
 * Icons are decorative: the control that holds one carries the accessible name,
 * so the glyph stays hidden from assistive tech instead of being read twice.
 */
export function Icon({ name, size = 16, className }: IconProps) {
  if (isNoiseIcon(name)) {
    // The PNG is used as a mask over `currentColor`, so it follows the theme
    // and the disabled state like the stroked icons do.
    const mask = `url("${NOISE_IMAGES[name]}") center / contain no-repeat`;
    return (
      <span
        className={className ? `icon-image ${className}` : "icon-image"}
        aria-hidden="true"
        style={{
          display: "inline-block",
          flexShrink: 0,
          width: size,
          height: size,
          verticalAlign: "middle",
          backgroundColor: "currentColor",
          mask,
          WebkitMask: mask,
        }}
      />
    );
  }

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
