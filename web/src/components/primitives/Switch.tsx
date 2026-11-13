"use client";

import { Switch as UiSwitch } from "@stellarr/ui";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * Required: the switch draws a track and a knob and no text, so without a
   * label a screen reader has nothing to announce. Pass the visible row label.
   */
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <UiSwitch
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      className={className}
    />
  );
}
