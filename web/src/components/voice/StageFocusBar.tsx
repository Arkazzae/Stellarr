"use client";

import { Icon } from "@/components/icons/Icon";
import type { ScreenShareVM } from "@/components/view-models";
import { useLanguage } from "@/state/LanguageProvider";

export type StageFocus = "share" | "tiles";

export interface StageFocusBarProps {
  focus: StageFocus;
  onFocus: (focus: StageFocus) => void;
  share: ScreenShareVM;
}

/**
 * What the stage shows: a choice this client makes for itself, never server
 * state. It only makes sense once there is a screen share to choose between
 * and the tiles.
 */
export function StageFocusBar({ focus, onFocus, share }: StageFocusBarProps) {
  const { t } = useLanguage();

  const segments = [
    {
      value: "share",
      label: t("activities.focusShare", { name: share.ownerName }),
      icon: "screencast",
    },
    { value: "tiles", label: t("activities.focusTiles"), icon: "users" },
  ] as const;

  return (
    <div className="stage-focus" role="group" aria-label={t("activities.focusLabel")}>
      {segments.map(({ value, label, icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={focus === value}
          className={focus === value ? "stage-focus-seg on" : "stage-focus-seg"}
          onClick={() => onFocus(value)}
          title={label}
        >
          <Icon name={icon} size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
