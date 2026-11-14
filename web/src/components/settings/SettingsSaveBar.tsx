"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/hooks";

import { useSettingsGuard } from "./settingsGuard";

export interface SettingsSaveBarProps {
  /** The pane holds something it has not saved. */
  dirty: boolean;
  saving: boolean;
  /** Set for a moment after a save went through. */
  saved: boolean;
  /** Saving is not possible right now, even with changes. */
  saveDisabled?: boolean;
  onSave: () => void;
  /** Back to what is saved. */
  onReset: () => void;
}

/**
 * Where a settings form is saved.
 *
 * Switches, choices and sliders save on their own and never show it. A form
 * that is typed into holds a draft, and its save lives here rather than at
 * the foot of the form: it is on screen however long the form is, it is there
 * only while something can be saved, and it holds the dialog while it is,
 * so changing pane or closing does not throw the draft away. A try to leave
 * turns it to "save or reset first" and shakes it.
 *
 * It renders at the foot of the pane column when a dialog provides one, and
 * in place otherwise, which is how a pane renders on its own in a test.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  saved,
  saveDisabled = false,
  onSave,
  onReset,
}: SettingsSaveBarProps) {
  const { t } = useLanguage();
  const guard = useSettingsGuard();
  const [blocked, setBlocked] = useState(false);
  const [nudges, setNudges] = useState(0);

  // A saved or reset draft no longer stands in the way.
  if (!dirty && blocked) setBlocked(false);

  useEffect(() => {
    if (!dirty || guard === null) return;
    return guard.hold(() => {
      setBlocked(true);
      setNudges((count) => count + 1);
      return true;
    });
  }, [dirty, guard]);

  if (!dirty && !saved) return null;

  // "Saved" wins for its moment: the store may hand the saved values back a
  // render after the save resolves, and the bar should not flash "unsaved".
  const state = saved ? "saved" : blocked ? "blocked" : "dirty";
  const bar = (
    <div
      className="sv-save"
      data-state={state}
      // Two names for one shake, so every further try replays it.
      data-nudge={nudges === 0 ? undefined : nudges % 2 === 0 ? "a" : "b"}
      role="region"
      aria-label={t("settings.unsaved.region")}
    >
      <span className="sv-save-txt" role="status">
        {state === "saved" ? (
          <b>
            <Icon name="tick" size={15} />
            {t("common.saved")}
          </b>
        ) : (
          <>
            <b>{state === "blocked" ? t("settings.unsaved.blocked") : t("settings.unsaved.title")}</b>
            <span>
              {state === "blocked"
                ? t("settings.unsaved.blockedDetail")
                : t("settings.unsaved.detail")}
            </span>
          </>
        )}
      </span>
      {state === "saved" ? null : (
        <>
          <Button type="button" variant="quiet" disabled={saving} onClick={onReset}>
            {t("common.reset")}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saveDisabled || saving}
            onClick={onSave}
          >
            {saving ? t("common.saving") : t("common.saveChanges")}
          </Button>
        </>
      )}
    </div>
  );

  return guard?.slot ? createPortal(bar, guard.slot) : bar;
}
