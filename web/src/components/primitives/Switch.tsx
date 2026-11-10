"use client";

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
  const classes = ["sw", checked ? "on" : null, className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}
