import { CircleCheck, CircleDashed, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { t, type MessageKey } from "@/i18n";
import type { OpsRuntimeService } from "@/lib/api";

type ServiceState = OpsRuntimeService["state"];

const appearance: Record<
  ServiceState,
  { labelKey: MessageKey; variant: "success" | "warning" | "destructive" | "outline"; icon: LucideIcon }
> = {
  healthy: { labelKey: "status.healthy", variant: "success", icon: CircleCheck },
  warning: { labelKey: "status.warning", variant: "warning", icon: TriangleAlert },
  error: { labelKey: "status.error", variant: "destructive", icon: CircleX },
  inactive: { labelKey: "status.inactive", variant: "outline", icon: CircleDashed },
};

export function StatusBadge({ state, label }: { state: ServiceState; label?: string }) {
  const { labelKey, variant, icon: Icon } = appearance[state];

  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {label ?? t(labelKey)}
    </Badge>
  );
}
