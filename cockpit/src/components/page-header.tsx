import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

/**
 * A page's line above its cards: what the page holds, and its actions. The bar
 * above the page already names it, as on the overview, so the heading is for
 * assistive tech.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="sr-only">{title}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
