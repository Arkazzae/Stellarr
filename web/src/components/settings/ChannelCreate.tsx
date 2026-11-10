"use client";

import { useId, useState } from "react";

import { Segmented } from "@/components/primitives/Segmented";
import { CreateDialog } from "@/components/settings/CreateDialog";
import { toChannelSlug } from "@/lib/format";
import type { ChannelKind, NewChannel } from "@/ports";
import { useLanguage } from "@/state/hooks";

export interface ChannelCreateProps {
  open: boolean;
  onClose: () => void;
  /** Which caption's "+" was pressed; the dialog opens on that kind. */
  kind: ChannelKind;
  /** False keeps the form walkable and read-only, as every unwired pane does. */
  supported: boolean;
  /** Offered as an optional home for the new channel; none hides the field. */
  sections: readonly { id: string; name: string }[];
  onCreate: (input: NewChannel) => Promise<void>;
}

/** The "+" beside a rail caption: a name, a kind and an optional section. */
export function ChannelCreate({
  open,
  onClose,
  kind,
  supported,
  sections,
  onCreate,
}: ChannelCreateProps) {
  const { t } = useLanguage();
  const nameFieldId = useId();
  const sectionFieldId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [chosenKind, setChosenKind] = useState<ChannelKind>(kind);
  const [sectionId, setSectionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset while rendering, not in an effect, so the "+" beside the voice
  // caption never opens on the kind the previous press chose.
  const [previous, setPrevious] = useState({ kind, open });
  if (previous.kind !== kind || previous.open !== open) {
    setPrevious({ kind, open });
    setChosenKind(kind);
    setError(null);
    if (!open) {
      setName("");
      setSectionId("");
      setSubmitting(false);
    }
  }

  const slug = toChannelSlug(name);
  const locked = !supported || submitting;

  const submit = async () => {
    if (locked || slug.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: slug,
        kind: chosenKind,
        ...(sectionId === "" ? {} : { sectionId }),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("channel.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const prefix = chosenKind === "voice" ? "" : "#";

  return (
    <CreateDialog
      open={open}
      onClose={onClose}
      title={t("channel.new")}
      detail={t("channel.newDetail")}
      submitLabel={t("settings.addChannel")}
      busy={submitting}
      busyLabel={t("channel.creating")}
      canSubmit={supported && slug.length > 0}
      onSubmit={() => void submit()}
    >
      {supported ? null : <p className="set-note">{t("settings.createChannelUnsupported")}</p>}

      <div className="frm">
        <div className="frm-row">
          <span className="frm-lab">
            {t("channel.kind")}
            <span>{t("channel.kindDetail")}</span>
          </span>
          <div className="frm-ctl">
            <Segmented
              label={t("channel.kind")}
              value={chosenKind}
              onChange={setChosenKind}
              disabled={locked}
              options={[
                { value: "text", label: t("channel.textKind") },
                { value: "voice", label: t("channel.voiceKind") },
              ]}
            />
          </div>
        </div>

        {sections.length > 0 && (
          <div className="frm-row">
            <label className="frm-lab" htmlFor={sectionFieldId}>
              {t("section.title")}
              <span>{t("section.channelSectionDetail")}</span>
            </label>
            <div className="frm-ctl">
              <select
                id={sectionFieldId}
                className="set-input"
                value={sectionId}
                disabled={locked}
                onChange={(event) => setSectionId(event.target.value)}
              >
                <option value="">{t("channel.unsectioned")}</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="frm-row">
          <label className="frm-lab" htmlFor={nameFieldId}>
            {t("channel.name")}
            <span>
              {slug.length === 0
                ? t("channel.lowercaseAndHyphens")
                : t("channel.willCreate", { name: `${prefix}${slug}` })}
            </span>
          </label>
          <div className="frm-ctl">
            <input
              id={nameFieldId}
              className="set-input"
              type="text"
              value={name}
              maxLength={60}
              placeholder={
                chosenKind === "voice"
                  ? t("channel.placeholderVoice")
                  : t("channel.placeholderText")
              }
              disabled={locked}
              required
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
