"use client";

import { useId, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Popover, type PopoverTriggerProps } from "@/components/primitives/Popover";

/**
 * One choice. It carries its own handler instead of a value handed back to the
 * menu, so one menu can hold settings of different types without a cast.
 */
export interface QualityOption {
  id: string;
  label: string;
  /** The short right-hand column, such as "720p · 30 kl./s" or "≈64 kb/s". */
  detail?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A heading and the choices under it. */
export interface QualityGroup {
  caption: string;
  options: readonly QualityOption[];
}

export interface QualityMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderTrigger: (props: PopoverTriggerProps) => ReactNode;
  /** Which edge of its button group the panel lines up with. */
  align?: "left" | "right";
  title: string;
  /** What is in force now, shown under the title. */
  summary: string;
  icon: IconName;
  groups?: readonly QualityGroup[];
  /** Explains why the body is empty or limited. */
  note?: string;
  /** The way out to the full settings dialog. */
  footer?: { label: string; onSelect: () => void };
}

/**
 * The drawer behind the small arrow next to the microphone, camera and screen
 * buttons: a heading, one radio group per `QualityGroup` and an optional link
 * to the full settings.
 */
export function QualityMenu({
  open,
  onOpenChange,
  renderTrigger,
  align = "left",
  title,
  summary,
  icon,
  groups = [],
  note,
  footer,
}: QualityMenuProps) {
  const radioName = useId();

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      className={align === "right" ? "vc-menu right" : "vc-menu"}
      renderTrigger={renderTrigger}
    >
      <div className="qm-head">
        <span className="qm-head-icon" aria-hidden="true">
          <Icon name={icon} size={17} />
        </span>
        <span className="qm-head-copy">
          <b>{title}</b>
          <span>{summary}</span>
        </span>
      </div>
      {note === undefined ? null : <p className="qm-note">{note}</p>}
      {groups.map((group, index) => (
        <div
          key={group.caption}
          className="qm-group"
          role="radiogroup"
          aria-label={group.caption}
        >
          <div className="qm-caption">{group.caption}</div>
          {group.options.map((option) => (
            <label
              key={option.id}
              className={["qm-option", option.selected && "on", option.disabled && "disabled"]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                className="qm-radio"
                type="radio"
                name={`${radioName}-${index}`}
                checked={option.selected}
                disabled={option.disabled}
                onChange={option.onSelect}
              />
              <span className="qm-marker" aria-hidden="true">
                {option.selected ? <Icon name="tick" size={14} /> : null}
              </span>
              <span className="qm-label">{option.label}</span>
              {option.detail === undefined ? null : (
                <span className="qm-detail">{option.detail}</span>
              )}
            </label>
          ))}
        </div>
      ))}
      {footer === undefined ? null : (
        <button
          type="button"
          className="qm-more"
          onClick={() => {
            onOpenChange(false);
            footer.onSelect();
          }}
        >
          <span className="qm-more-icon" aria-hidden="true">
            <Icon name="sliders" size={14} />
          </span>
          {footer.label}
        </button>
      )}
    </Popover>
  );
}
