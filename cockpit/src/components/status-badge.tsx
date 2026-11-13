import { Badge } from "@stellarr/ui";

import { t, type MessageKey } from "@/i18n";
import type { CockpitRuntimeService } from "@/lib/api";

type ServiceState = CockpitRuntimeService["state"];

/** The word names the state; the colour only repeats it. */
const appearance: Record<
  ServiceState,
  { labelKey: MessageKey; variant: "success" | "warning" | "destructive" | "outline" }
> = {
  healthy: { labelKey: "status.healthy", variant: "success" },
  warning: { labelKey: "status.warning", variant: "warning" },
  error: { labelKey: "status.error", variant: "destructive" },
  inactive: { labelKey: "status.inactive", variant: "outline" },
};

export function StatusBadge({ state, label }: { state: ServiceState; label?: string }) {
  const { labelKey, variant } = appearance[state];

  return <Badge variant={variant}>{label ?? t(labelKey)}</Badge>;
}
