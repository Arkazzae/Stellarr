"use client";

import { Icon } from "@/components/icons/Icon";
import { Switch } from "@/components/primitives/Switch";
import {
  PermissionOverrideEditor,
  type PermissionOverridePatch,
} from "@/components/settings/PermissionOverrideEditor";
import { SettingsSection } from "@/components/settings/SettingsSection";
import type { ChannelSettingsVM } from "@/components/settings/channelSettingsModel";
import type { Translator } from "@/i18n";
import type { PermissionOverride, Role } from "@/ports";

export interface NotificationsPaneProps {
  muted: boolean;
  supported: boolean;
  onMutedChange: (muted: boolean) => void;
  t: Translator;
}

/** This member's own mute for the channel; it saves as soon as it flips. */
export function NotificationsPane({ muted, supported, onMutedChange, t }: NotificationsPaneProps) {
  return (
    <SettingsSection title={t("channel.notifications")} icon="bell">
      <div className="frm">
        <div className="frm-row">
          <span className="frm-lab">
            {t("channel.muteNotifications")}
            <span>{t("channel.muteNotificationsDetail")}</span>
          </span>
          <div className="frm-ctl frm-switch">
            <Switch
              checked={muted}
              onChange={onMutedChange}
              label={t("channel.muteNotifications")}
              disabled={!supported}
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export interface PermissionsPaneProps {
  roles: readonly Role[];
  permissionsSupported: boolean;
  permissionOverrides: readonly PermissionOverride[];
  onSavePermissionOverride: (roleId: string, patch: PermissionOverridePatch) => Promise<void>;
  onOpenRoles: () => void;
  t: Translator;
}

export function PermissionsPane({
  roles,
  permissionsSupported,
  permissionOverrides,
  onSavePermissionOverride,
  onOpenRoles,
  t,
}: PermissionsPaneProps) {
  return (
    <SettingsSection title={t("channel.channelPermissions")} icon="shield">
      <p className="fld-note">{t("channel.permissionsDetailText")}</p>
      {roles.length === 0 ? (
        <p className="fld-note">{t("channel.noRoles")}</p>
      ) : (
        <PermissionOverrideEditor
          supported={permissionsSupported}
          roles={roles}
          overrides={permissionOverrides}
          onSave={onSavePermissionOverride}
        />
      )}
      <button type="button" className="btn-ghost sm" onClick={onOpenRoles}>
        <Icon name="shield" size={15} />
        {t("channel.openServerRoles")}
      </button>
    </SettingsSection>
  );
}

export interface DangerPaneProps {
  current: ChannelSettingsVM | null;
  supported: boolean;
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  onDelete: () => void;
  t: Translator;
}

export function DangerPane({
  current,
  supported,
  confirming,
  setConfirming,
  onDelete,
  t,
}: DangerPaneProps) {
  return (
    <SettingsSection title={t("channel.delete")} icon="trash" className="danger-section">
      <p className="fld-note">{t("channel.deleteWarning")}</p>
      {confirming ? (
        <div className="ch-confirm">
          <button
            type="button"
            className="btn-danger sm"
            disabled={!supported}
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            <Icon name="trash" size={15} />
            {current === null
              ? t("channel.delete")
              : t("settings.deleteNamedServer", {
                  name: `${current.kind === "voice" ? "" : "#"}${current.name}`,
                })}
          </button>
          <button type="button" className="btn-ghost sm" onClick={() => setConfirming(false)}>
            <Icon name="x" size={14} />
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-danger sm"
          disabled={!supported}
          onClick={() => setConfirming(true)}
        >
          <Icon name="trash" size={15} />
          {t("channel.delete")}
        </button>
      )}
    </SettingsSection>
  );
}
