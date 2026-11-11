import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A row of figures read together, drawn as one block split by hairlines rather
 * than as separate cards. The one-pixel gap shows the border colour between
 * the cells, so the lines follow any number of columns.
 */
export function StatGrid({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn("grid gap-px overflow-hidden rounded-lg border bg-border", className)}
    >
      {children}
    </section>
  );
}

/** One figure: what it counts, the value, and an optional line about it. */
export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div role="group" aria-label={label} className="bg-background px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
