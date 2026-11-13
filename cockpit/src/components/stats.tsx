import { cx } from "@stellarr/ui";
import type { ReactNode } from "react";

/** A row of figures read together, each its own tile as on the overview. */
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
    <section aria-label={label} className={cx("grid gap-3", className)}>
      {children}
    </section>
  );
}

/** One figure: what it counts, the value, and an optional line about it. */
export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div role="group" aria-label={label} className="rounded-2xl border border-border/70 bg-card px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl leading-tight font-semibold tracking-[-0.02em]">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
