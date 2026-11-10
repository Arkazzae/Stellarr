"use client";

import { useId, type ReactNode } from "react";

import { Icon } from "@/components/icons/Icon";
import { Modal } from "@/components/primitives/Modal";
import { useLanguage } from "@/state/hooks";

export interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  detail: string;
  submitLabel: string;
  /** A request is in flight: the dialog cannot be dismissed and shows `busyLabel`. */
  busy: boolean;
  busyLabel: string;
  /** Whether the form holds enough to submit. */
  canSubmit: boolean;
  onSubmit: () => void;
  /** The fields, and whatever notes and errors belong with them. */
  children: ReactNode;
}

/**
 * The frame of the small "create one thing" dialogs opened from the rail:
 * a title, a close button, the fields, and cancel and submit buttons.
 */
export function CreateDialog({
  open,
  onClose,
  title,
  detail,
  submitLabel,
  busy,
  busyLabel,
  canSubmit,
  onSubmit,
  children,
}: CreateDialogProps) {
  const { t } = useLanguage();
  const titleId = useId();

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal open={open} onClose={close} labelledBy={titleId} className="act-modal ch-modal" exitMs={200}>
      <form
        className="am-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
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
              disabled={busy}
              onClick={close}
            >
              <Icon name="x" size={18} />
            </button>
            <span>ESC</span>
          </div>
        </header>

        <div className="ch-body">{children}</div>

        <footer className="ch-foot">
          <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !canSubmit}
            aria-busy={busy || undefined}
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
