import { Icon as StellarrIcon, type IconName } from "@stellarr/ui/icons";

export type { IconName };

interface IconProps {
  name: IconName;
  /** Side of the square box in pixels at the default font size; drawn in rem, so it scales with the panel. */
  size?: number;
  className?: string;
}

/**
 * Stellarr's icon set from @stellarr/ui, the same glyphs as the web client.
 * Cockpit draws the box in rem so icons follow the panel's scale (index.css)
 * with the text around them. Icons are decorative: the control that holds one
 * carries the accessible name, so the glyph stays hidden from assistive tech.
 */
export function Icon({ name, size = 16, className }: IconProps) {
  const side = `${size / 16}rem`;
  return <StellarrIcon name={name} size={size} className={className} style={{ width: side, height: side }} />;
}
