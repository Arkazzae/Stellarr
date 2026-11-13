"use client";

import { Icon } from "@stellarr/ui/icons";

export interface DialogCloseProps {
  /** The button's accessible name, such as "Close" or "Close settings". */
  label: string;
  onClose: () => void;
  /** A request is in flight and the dialog cannot be dismissed. */
  disabled?: boolean;
}

/**
 * The way out of a dialog: a bare cross on the dialog's own surface.
 *
 * No ring and no key caption. Escape still closes every dialog, and a ringed
 * button beside the title competed with it for the first look.
 */
export function DialogClose({ label, onClose, disabled = false }: DialogCloseProps) {
  return (
    <button
      type="button"
      className="dlg-x"
      aria-label={label}
      disabled={disabled}
      onClick={onClose}
    >
      <Icon name="x" size={20} />
    </button>
  );
}
