import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/icon";

/** A card's title row: a quiet icon and the name, with room for a figure or controls at the end. */
export function CardTitleRow({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3">
      <Icon name={icon} size={16} className="text-muted-foreground" />
      <h2 className="mr-auto text-base">{title}</h2>
      {children}
    </div>
  );
}
