import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";

export interface SettingsSectionProps {
  title: string;
  icon: IconName;
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

/** The card every settings pane is made of: an icon and title, then a body. */
export function SettingsSection({
  title,
  icon,
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
        <span className="sc-ico" aria-hidden="true">
          <Icon name={icon} size={17} />
        </span>
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
