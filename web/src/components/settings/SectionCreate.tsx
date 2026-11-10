"use client";

import { useId, useState } from "react";

import { CreateDialog } from "@/components/settings/CreateDialog";
import { useLanguage } from "@/state/hooks";

export interface SectionCreateProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string }) => Promise<void>;
}

/** "Add section" in the rail: a name, and nothing else. */
export function SectionCreate({ open, onClose, onCreate }: SectionCreateProps) {
  const { t } = useLanguage();
  const nameFieldId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset while rendering, not in an effect, so a reopened dialog starts blank.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setError(null);
    if (!open) {
      setName("");
      setSubmitting(false);
    }
  }

  const trimmed = name.trim();

  const submit = async () => {
    if (submitting || trimmed.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: trimmed });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("section.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CreateDialog
      open={open}
      onClose={onClose}
      title={t("section.new")}
      detail={t("section.newDetail")}
      submitLabel={t("section.new")}
      busy={submitting}
      busyLabel={t("section.creating")}
      canSubmit={trimmed.length > 0}
      onSubmit={() => void submit()}
    >
      <div className="frm">
        <div className="frm-row">
          <label className="frm-lab" htmlFor={nameFieldId}>
            {t("section.name")}
            <span>{t("section.nameDetail")}</span>
          </label>
          <div className="frm-ctl">
            <input
              id={nameFieldId}
              className="set-input"
              type="text"
              value={name}
              maxLength={60}
              placeholder={t("section.namePlaceholder")}
              disabled={submitting}
              required
              autoComplete="off"
              aria-invalid={error !== null || undefined}
              aria-describedby={error === null ? undefined : errorId}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
          </div>
        </div>
      </div>

      {error === null ? null : (
        <p id={errorId} className="set-note sound-error" role="alert">
          {error}
        </p>
      )}
    </CreateDialog>
  );
}
