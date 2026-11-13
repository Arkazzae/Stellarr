"use client";

import { useId, type ReactNode } from "react";

import { Button } from "@stellarr/ui";
import { Modal } from "@/components/primitives/Modal";
import { DialogHeader } from "@/components/settings/DialogHeader";
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
  /** Names the dialog's own variant on the wrapper, beside `act-modal`. */
  className?: string;
  /**
   * Lines that belong to the answer rather than to the fields: what the input
   * will become, and the error a submit came back with. They sit above the
   * buttons outside the scrolling body, so a long body never hides them.
   */
  notes?: ReactNode;
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
  className = "ch-modal",
  notes,
  children,
}: CreateDialogProps) {
  const { t } = useLanguage();
  const titleId = useId();

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      labelledBy={titleId}
      className={`act-modal ${className}`}
      exitMs={200}
    >
      <form
        className="am-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <DialogHeader
          titleId={titleId}
          title={title}
          detail={detail}
          onClose={close}
          closeDisabled={busy}
        />

        <div className="ch-body">{children}</div>

        {notes === undefined ? null : <div className="ch-notes">{notes}</div>}

        <footer className="ch-foot">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !canSubmit}
            aria-busy={busy || undefined}
          >
            {busy ? busyLabel : submitLabel}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
