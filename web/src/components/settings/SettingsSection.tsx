import type { ReactNode } from "react";

export interface SettingsSectionProps {
  title: string;
  /** A badge beside the title, such as how many items the block holds. */
  count?: ReactNode;
  countLabel?: string;
  countTitle?: string;
  /** Sits at the end of the header, such as an "add" button. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** The group every settings pane is made of: a heading, then a box of rows. */
export function SettingsSection({
  title,
  count,
  countLabel,
  countTitle,
  action,
  children,
  className,
  bodyClassName,
}: SettingsSectionProps) {
  const classes = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ");

  return (
    <section className={classes("sc settings-section", className)} aria-label={title}>
      <header className="sc-h asset-head">
        <span>{title}</span>
        {count === undefined ? null : (
          <span className="asset-count" aria-label={countLabel} title={countTitle}>
            {count}
          </span>
        )}
        {action}
      </header>
      <div className={classes("sc-b", bodyClassName)}>{children}</div>
    </section>
  );
}
