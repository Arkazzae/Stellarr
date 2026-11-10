"use client";

import { useDirectory, useUi } from "@/state/hooks";

import { ChannelCreateDialog, ChannelSettingsDialog } from "./ChannelDialogs";
import { InviteDialog } from "./InviteDialog";
import { SectionCreateDialog, SectionSettingsDialog } from "./SectionDialogs";
import { ServerDirectoryDialogs } from "./ServerDirectoryDialogs";
import { ServerSettingsDialog } from "./ServerSettingsDialog";
import { useServerAdmin } from "./useServerAdmin";

/** Every dialog the shell can raise, each wired to its port. */
export function ModalsContainer() {
  const directory = useDirectory();
  const ui = useUi();

  const settingsOpen = ui.modal === "settings" && directory.canAccessServerSettings;
  const inviteOpen = ui.modal === "invite" && directory.canManageServer;
  // Fetched when a dialog that shows any of it opens, not at boot.
  const admin = useServerAdmin(
    settingsOpen || inviteOpen || ui.modal === "channel" || ui.modal === "section",
  );

  return (
    <>
      <ServerDirectoryDialogs />
      <ServerSettingsDialog open={settingsOpen} {...admin} />
      <InviteDialog open={inviteOpen} {...admin} />
      <ChannelSettingsDialog roles={admin.data.roles} />
      <ChannelCreateDialog />
      <SectionSettingsDialog roles={admin.data.roles} />
      <SectionCreateDialog />
    </>
  );
}
