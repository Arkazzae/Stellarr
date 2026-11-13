import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@stellarr/ui";
import { useEffect, useState } from "react";

import { t } from "@/i18n";
import { onFreshSecondStepRequired } from "@/lib/api";
import { webFreshConfirmUrl } from "@/lib/web-sign-in";

/**
 * Opens when the server refuses a sensitive change for want of a second step
 * from the last few minutes, whichever page made it. The step is confirmed in
 * the web client, which then brings the owner back to the same page.
 */
export function FreshSecondStepDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => onFreshSecondStepRequired(() => setOpen(true)), []);

  // Read when shown: the page that asked, under Cockpit's own base path.
  const back = open ? `${window.location.pathname}${window.location.search}` : "/cockpit/";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("fresh.title")}</DialogTitle>
          <DialogDescription>{t("fresh.description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("fresh.cancel")}
            </Button>
          </DialogClose>
          {/* A plain link: the sign-in page is the web client's, outside this app's router. */}
          <Button asChild>
            <a href={webFreshConfirmUrl(back)}>{t("gate.mfa.confirm")}</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
