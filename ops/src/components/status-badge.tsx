import { CircleCheck, CircleDashed, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { OpsRuntimeService } from "@/lib/api";

type ServiceState = OpsRuntimeService["state"];

const appearance: Record<
  ServiceState,
  { label: string; variant: "success" | "warning" | "destructive" | "outline"; icon: LucideIcon }
> = {
  healthy: { label: "Działa", variant: "success", icon: CircleCheck },
  warning: { label: "Wymaga uwagi", variant: "warning", icon: TriangleAlert },
  error: { label: "Błąd", variant: "destructive", icon: CircleX },
  inactive: { label: "Nieaktywne", variant: "outline", icon: CircleDashed },
};

export function StatusBadge({ state, label }: { state: ServiceState; label?: string }) {
  const { label: defaultLabel, variant, icon: Icon } = appearance[state];

  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {label ?? defaultLabel}
    </Badge>
  );
}
