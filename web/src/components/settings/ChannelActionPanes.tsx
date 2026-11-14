"use client";

import { useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { Switch } from "@/components/primitives/Switch";
import {
  PermissionOverrideEditor,
  type PermissionOverridePatch,
} from "@/components/settings/PermissionOverrideEditor";
import { SettingsSection } from "@/components/settings/SettingsSection";
import {
  channelLabel,
  type ChannelSettingsVM,
} from "@/components/settings/channelSettingsModel";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { PermissionOverride, Role } from "@/ports";
import { useLanguage } from "@/state/hooks";

export interface NotificationsPaneProps {
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}

/** This member's own mute for the channel; it saves as soon as it flips. */
export function NotificationsPane({ muted, onMutedChange }: NotificationsPaneProps) {
  const { t } = useLanguage();
  return (
    <SettingsSection title={t("channel.notifications")}>
      <div className="frm ch-frm-flush">
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
}

export function PermissionsPane({
  roles,
  permissionsSupported,
  permissionOverrides,
  onSavePermissionOverride,
  onOpenRoles,
}: PermissionsPaneProps) {
  const { t } = useLanguage();
  return (
    <SettingsSection
      title={t("channel.channelPermissions")}
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="ch-roles-link"
          onClick={onOpenRoles}
        >
          <Icon name="shield" size={14} />
          {t("channel.openServerRoles")}
        </Button>
      }
    >
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
    </SettingsSection>
  );
}

export interface DangerPaneProps {
  channel: ChannelSettingsVM;
  supported: boolean;
  onDelete: () => Promise<void>;
}

/**
 * The server's danger zone, for one channel. Deleting takes a second press on
 * a button that names the channel, so the first press can never be the one
 * that loses its history.
 */
export function DangerPane({ channel, supported, onDelete }: DangerPaneProps) {
  const { t } = useLanguage();
  const action = useAsyncAction();
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsSection title={t("server.danger")} className="danger-section">
      {action.failed ? (
        <p className="set-note sound-error" role="alert">
          {t("channel.deleteFailed")}
        </p>
      ) : null}
      <div className="set-row danger">
        <span className="set-lab">
          <b>{t("channel.delete")}</b>
          <span>{t("channel.deleteWarning")}</span>
        </span>
        <span className="set-ctl">
          {confirming ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={action.pending}
                onClick={() => setConfirming(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={!supported || action.pending}
                onClick={() => void action.run(onDelete)}
              >
                {t("settings.deleteNamedServer", {
                  name: channelLabel(channel.kind, channel.name),
                })}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="danger"
              disabled={!supported}
              onClick={() => setConfirming(true)}
            >
              {t("channel.delete")}
            </Button>
          )}
        </span>
      </div>
    </SettingsSection>
  );
}
