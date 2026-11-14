"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/primitives/Modal";
import {
  DangerPane,
  NotificationsPane,
  PermissionsPane,
} from "@/components/settings/ChannelActionPanes";
import { ChannelOverviewPane } from "@/components/settings/ChannelFormPanes";
import {
  channelLabel,
  initialPane,
  navigationFor,
  type ChannelSettingsPaneKey,
  type ChannelSettingsVM,
} from "@/components/settings/channelSettingsModel";
import type { PermissionOverridePatch } from "@/components/settings/PermissionOverrideEditor";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SettingsGuardProvider, useSettingsGuardHost } from "@/components/settings/settingsGuard";
import type { ChannelPatch, PermissionOverride, Role } from "@/ports";
import { useLanguage } from "@/state/hooks";

export type { ChannelSettingsVM } from "@/components/settings/channelSettingsModel";

export interface ChannelSettingsProps {
  open: boolean;
  onClose: () => void;
  /** Null while the dialog is closing and the rail has moved on. */
  channel: ChannelSettingsVM | null;
  /** False when this member may not manage channels: the form stays legible and read-only. */
  supported: boolean;
  /** Whether this member may see administrative channel panes. */
  canManageChannel: boolean;
  roles: readonly Role[];
  /** False when this member may not manage roles, so overrides are read-only. */
  permissionsSupported: boolean;
  permissionOverrides: readonly PermissionOverride[];
  notificationMuted: boolean;
  onNotificationMutedChange: (muted: boolean) => void;
  onSave: (patch: ChannelPatch) => Promise<void>;
  onSavePermissionOverride: (roleId: string, patch: PermissionOverridePatch) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Opens the server dialog on its roles pane; a role's own base permissions live there. */
  onOpenRoles: () => void;
}

/**
 * One channel's settings, in the server settings' own shell: the channel's
 * name in the side panel, the same captioned groups, and each pane's actions
 * inside its card rather than in a bar shared by panes that have nothing to
 * save.
 */
export function ChannelSettings({
  open,
  onClose,
  channel,
  supported,
  canManageChannel,
  roles,
  permissionsSupported,
  permissionOverrides,
  notificationMuted,
  onNotificationMutedChange,
  onSave,
  onSavePermissionOverride,
  onDelete,
  onOpenRoles,
}: ChannelSettingsProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const guard = useSettingsGuardHost();
  const [active, setActive] = useState<ChannelSettingsPaneKey>(() =>
    initialPane(channel, canManageChannel),
  );

  // Re-seeded during render so opening a second channel never shows the first
  // one's pane for a frame. The panes keep their drafts in local state and are
  // keyed by pane, so the next channel starts from its own values.
  const [seed, setSeed] = useState(channel?.id ?? null);
  if (seed !== (channel?.id ?? null)) {
    setSeed(channel?.id ?? null);
    setActive(initialPane(channel, canManageChannel));
  }

  const navigation = navigationFor(channel?.kind ?? "text", canManageChannel, t);
  const items = navigation.flatMap((group) => group.items);
  // A closed dialog for a regular member can briefly have no channel: its
  // initial pane is the overview, but the only pane it may show is
  // notifications. The fallback is written back so a later permission change
  // keeps the pane on screen instead of reviving the stale one; once written it
  // matches `active`, so this settles after a single extra render.
  const selected = items.find((item) => item.key === active) ?? items[0];
  const resolvedActive = selected?.key ?? "notifications";
  if (resolvedActive !== active) setActive(resolvedActive);

  const label = channel === null ? t("channel.channel") : channelLabel(channel.kind, channel.name);

  const pane = () => {
    switch (resolvedActive) {
      case "overview":
        return channel === null ? null : (
          <ChannelOverviewPane key={channel.id} channel={channel} supported={supported} onSave={onSave} />
        );
      case "notifications":
        return (
          <NotificationsPane muted={notificationMuted} onMutedChange={onNotificationMutedChange} />
        );
      case "permissions":
        return (
          <PermissionsPane
            roles={roles}
            permissionsSupported={permissionsSupported}
            permissionOverrides={permissionOverrides}
            onSavePermissionOverride={onSavePermissionOverride}
            onOpenRoles={onOpenRoles}
          />
        );
      case "danger":
        return channel === null ? null : (
          <DangerPane key={channel.id} channel={channel} supported={supported} onDelete={onDelete} />
        );
    }
  };

  // Notifications are this member's own setting, so only the administrative
  // panes can be read-only.
  const readOnly = resolvedActive !== "notifications" && !supported;

  return (
    <Modal
      open={open}
      onClose={() => guard.attempt(onClose)}
      labelledBy={titleId}
      className="sv-wrap"
    >
      <SettingsGuardProvider guard={guard}>
        <SettingsShell
          titleId={titleId}
          brand={{
            name: label,
            detail: t("channel.settings"),
            label: t("channel.settingsLabel", { name: label }),
          }}
          title={selected?.label ?? ""}
          detail={selected?.detail ?? ""}
          closeLabel={t("common.closeChannelSettings")}
          onClose={onClose}
          navLabel={t("channel.settingsSections")}
          groups={navigation}
          active={resolvedActive}
          onSelect={setActive}
          className="ch-settings"
        >
          {readOnly ? <p className="set-note">{t("channel.settingsUnsupported")}</p> : null}
          {pane()}
        </SettingsShell>
      </SettingsGuardProvider>
    </Modal>
  );
}
