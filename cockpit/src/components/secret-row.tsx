import { Badge } from "@/components/ui/badge";
import { t, type MessageKey } from "@/i18n";

/** A secret that lives only in the server's environment, and whether it is set. */
export function SecretRow({ title, variable, configured, missingKey }: { title: string; variable: string; configured: boolean; missingKey: MessageKey }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t pt-5">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {t("settings.delivery.keyBefore")}{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{variable}</code>{" "}
          {t("settings.delivery.keyAfter")}
        </p>
      </div>
      <Badge variant={configured ? "success" : "outline"}>
        {configured ? t("settings.delivery.keyConfigured") : t(missingKey)}
      </Badge>
    </div>
  );
}
