import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-display font-semibold">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t("notFound.description")}
        </p>
        <Button asChild className="mt-6">
          <Link to="/">
            {t("notFound.back")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
