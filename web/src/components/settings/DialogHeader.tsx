"use client";

import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/hooks";

export interface DialogHeaderProps {
  /** The id the dialog's `labelledBy` points at. */
  titleId: string;
  title: string;
  detail: string;
  onClose: () => void;
  /** A request is in flight and the dialog cannot be dismissed. */
  closeDisabled?: boolean;
}

/** The title band of the short `act-modal` dialogs: heading, sentence, close. */
export function DialogHeader({
  titleId,
  title,
  detail,
  onClose,
  closeDisabled = false,
}: DialogHeaderProps) {
  const { t } = useLanguage();

  return (
    <header className="am-head">
      <div className="am-title">
        <h2 id={titleId}>{title}</h2>
        <p>{detail}</p>
      </div>
      <div className="sv-close">
        <button
          type="button"
          className="sv-x"
          aria-label={t("common.close")}
          disabled={closeDisabled}
          onClick={onClose}
        >
          <Icon name="x" size={18} />
        </button>
        <span>ESC</span>
      </div>
    </header>
  );
}
