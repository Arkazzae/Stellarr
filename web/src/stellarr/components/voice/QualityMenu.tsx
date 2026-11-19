import { Fragment, useId, type ReactNode } from "react";

import { Icon } from "@stellarr/icons";
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
  title: string;
  /** What is in force now, shown under the title. */
  summary: string;
  groups?: readonly QualityGroup[];
  /** Explains why the body is empty or limited. */
  note?: string;
  /** The way out to the full settings dialog. */
  footer?: { label: string; onSelect: () => void };
}

/**
 * The drawer behind the small arrow next to the microphone, camera and screen
 * buttons: a title over what is in force, one radio group per `QualityGroup`
 * and an optional way out to the full settings. The rows are the account
 * panel's: the choice in the accent with a tick at the end of its row, a
 * hairline between groups.
 */
export function QualityMenu({
  open,
  onOpenChange,
  renderTrigger,
  title,
  summary,
  groups = [],
  note,
  footer,
}: QualityMenuProps) {
  const radioName = useId();

  return (
    <Popover open={open} onOpenChange={onOpenChange} className="vc-menu" renderTrigger={renderTrigger}>
      <div className="qm-head">
        <b>{title}</b>
        <span>{summary}</span>
      </div>
      {note === undefined ? null : <p className="qm-note">{note}</p>}
      {groups.map((group, index) => (
        <Fragment key={group.caption}>
          {index === 0 ? null : <hr className="qm-sep" />}
          <div className="qm-group" role="radiogroup" aria-label={group.caption}>
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
                <span className="qm-label">{option.label}</span>
                {option.detail === undefined ? null : (
                  <span className="qm-detail">{option.detail}</span>
                )}
                {/* Every row keeps the slot, so the details line up. */}
                <span className="qm-marker" aria-hidden="true">
                  {option.selected ? <Icon name="tick" size={14} /> : null}
                </span>
              </label>
            ))}
          </div>
        </Fragment>
      ))}
      {footer === undefined ? null : (
        <>
          <hr className="qm-sep" />
          <button
            type="button"
            className="qm-more"
            onClick={() => {
              onOpenChange(false);
              footer.onSelect();
            }}
          >
            <span className="qm-more-icon" aria-hidden="true">
              <Icon name="sliders" size={16} />
            </span>
            {footer.label}
          </button>
        </>
      )}
    </Popover>
  );
}
