"use client";

export interface ScrimProps {
  show: boolean;
  onDismiss: () => void;
}

/**
 * The dimmer behind an open drawer.
 *
 * It stays mounted so it can fade; CSS decides whether it can be hit. Assistive
 * tech skips it, because tapping it only repeats what Escape and the drawer's
 * own close control already do.
 */
export function Scrim({ show, onDismiss }: ScrimProps) {
  return (
    <div
      className={show ? "scrim show" : "scrim"}
      aria-hidden="true"
      onClick={onDismiss}
    />
  );
}
