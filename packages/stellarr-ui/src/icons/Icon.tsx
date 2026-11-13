import { createContext, use, type CSSProperties, type ReactNode } from "react";

import { iconPaths, type IconName, type IconVariant } from "./paths";

export type { IconName, IconVariant } from "./paths";

/** The family's default: the same contours as linear, each main one opened once. */
export const DEFAULT_ICON_VARIANT: IconVariant = "broken";

const IconVariantContext = createContext<IconVariant>(DEFAULT_ICON_VARIANT);

/** Draw every `Icon` inside in one variant, for an app, a surface or a user preference. */
export function IconVariantProvider({ variant, children }: { variant: IconVariant; children: ReactNode }) {
  return <IconVariantContext value={variant}>{children}</IconVariantContext>;
}

export interface IconProps {
  name: IconName;
  /** Side of the square box in pixels; controls use 12 to 24. */
  size?: number;
  /** Overrides the variant of the nearest `IconVariantProvider`, broken by default. */
  variant?: IconVariant;
  className?: string;
  /** For an app that sizes the box in its own unit, such as Cockpit's rem scale. */
  style?: CSSProperties;
}

/** The control carries the accessible name; its glyph is decorative. */
export function Icon({ name, size = 16, variant, className, style }: IconProps) {
  const inherited = use(IconVariantContext);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths(name, variant ?? inherited).map((path, index) => (
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
