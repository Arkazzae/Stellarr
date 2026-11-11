import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/icon";

/** A card's title row: an icon and a name above a hairline. */
export function CardTitleRow({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3.5">
      <Icon name={icon} size={18} className="text-muted-foreground" />
      <h2 className="mr-auto text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}
