import { Icon, type IconName } from "@/components/icons/Icon";

export interface ErrorNoticeAction {
  label: string;
  onClick: () => void;
}

export interface ErrorNoticeProps {
  title: string;
  message: string;
  /** A device or transport glyph tells the source before the copy is read. */
  icon?: IconName;
  /** The first action is drawn as the primary one. */
  actions?: readonly ErrorNoticeAction[];
  /** Drops the room-sized padding for use inside a settings row. */
  compact?: boolean;
  className?: string;
}

/**
 * A persistent, local error with its recovery next to it.
 *
 * Deliberately not a toast: a device or connection failure stays in the part of
 * the interface it affects, so the explanation and the action do not vanish
 * while someone checks browser or system settings.
 */
export function ErrorNotice({
  title,
  message,
  icon = "warning",
  actions = [],
  compact = false,
  className,
}: ErrorNoticeProps) {
  const classes = ["error-notice", compact ? "compact" : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="alert" aria-atomic="true">
      <span className="error-notice-icon" aria-hidden="true">
        <Icon name={icon} size={compact ? 17 : 19} />
      </span>
      <div className="error-notice-copy">
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {actions.length > 0 ? (
        <div className="error-notice-actions">
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              className={
                index === 0 ? "error-notice-action primary" : "error-notice-action"
              }
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
