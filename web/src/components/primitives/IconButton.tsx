"use client";

import type { MouseEventHandler } from "react";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";

export interface IconButtonProps {
  icon: IconName;
  /** An icon-only control has no text, so its accessible name is required. */
  label: string;
  /** The tooltip; usually the same words as the label. */
  title?: string;
  size?: number;
  /** Added to the button. Other button shapes are their own components. */
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  title,
  size = 16,
  className,
  disabled,
  onClick,
}: IconButtonProps) {
  return (
    <Button
      type="button"
      variant="quiet"
      size="icon-sm"
      className={className}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </Button>
  );
}
