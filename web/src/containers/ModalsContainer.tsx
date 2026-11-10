"use client";

import { useDirectory, useUi } from "@/state/hooks";

import { ServerSettingsDialog } from "./ServerSettingsDialog";
import { useServerAdmin } from "./useServerAdmin";

/** Every dialog the shell can raise, each wired to its port. */
export function ModalsContainer() {
  const directory = useDirectory();
  const ui = useUi();

  const settingsOpen = ui.modal === "settings" && directory.canAccessServerSettings;
  const { data, reload } = useServerAdmin(settingsOpen);

  return <ServerSettingsDialog open={settingsOpen} data={data} reload={reload} />;
}
