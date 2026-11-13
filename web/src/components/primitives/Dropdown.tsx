"use client";

import { Dropdown as SharedDropdown, type DropdownProps } from "@stellarr/ui";
import { useLanguage } from "@/state/hooks";

export type { DropdownOption, DropdownProps } from "@stellarr/ui";

/** The shared dropdown, which asks to choose in the app's language when nothing is chosen. */
export function Dropdown<T extends string>({ placeholder, ...props }: DropdownProps<T>) {
  const { t } = useLanguage();
  return <SharedDropdown placeholder={placeholder ?? t("common.choose")} {...props} />;
}
