"use client";

import { DialogClose } from "@/components/primitives/DialogClose";
import { useLanguage } from "@/state/hooks";

export interface DialogHeaderProps {
  /** The id the dialog's `labelledBy` points at. */
  titleId: string;
  title: string;
  detail: string;
  onClose: () => void;
  /** A request is in flight and the dialog cannot be dismissed. */
  closeDisabled?: boolean;
  /**
   * Title and sentence centred over the card, for a dialog whose body is a
   * list to pick from rather than a form to fill in.
   */
  centered?: boolean;
}

/**
 * The top of the short `act-modal` dialogs: a heading, the sentence under it
 * and a bare close in the corner, on the card's own surface.
 *
 * The close comes first in the DOM, so a dialog that does not move focus
 * itself opens on the harmless way out.
 */
export function DialogHeader({
  titleId,
  title,
  detail,
  onClose,
  closeDisabled = false,
  centered = false,
}: DialogHeaderProps) {
  const { t } = useLanguage();

  return (
    <header className={centered ? "am-head centered" : "am-head"}>
      <DialogClose label={t("common.close")} onClose={onClose} disabled={closeDisabled} />
      <h2 id={titleId}>{title}</h2>
      <p>{detail}</p>
    </header>
  );
}
