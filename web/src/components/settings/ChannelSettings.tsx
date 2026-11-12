"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";

import { Icon, type IconName } from "@stellarr/ui/icons";
import { Modal } from "@/components/primitives/Modal";
import {
  DangerPane,
  NotificationsPane,
  PermissionsPane,
} from "@/components/settings/ChannelActionPanes";
import { GeneralPane, VoicePane } from "@/components/settings/ChannelFormPanes";
import {
  initialPane,
  navigationFor,
  type ChannelSettingsPaneKey,
  type ChannelSettingsVM,
} from "@/components/settings/channelSettingsModel";
import type { PermissionOverridePatch } from "@/components/settings/PermissionOverrideEditor";
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
 * One channel's settings, using the same shell and navigation vocabulary as
 * user and server settings. The panes are separated by intent so permissions
 * and deletion never sit below a long codec form.
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
  const panesRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ChannelSettingsVM | null>(channel);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [active, setActive] = useState<ChannelSettingsPaneKey>(() =>
    initialPane(channel, canManageChannel),
  );

  // Re-seeded during render so opening a second channel never shows the first
  // one's name, selected pane or pending delete confirmation for a frame.
  const [seed, setSeed] = useState(channel);
  if (seed !== channel) {
    setSeed(channel);
    setDraft(channel);
    setConfirming(false);
    setSaving(false);
    setActionError(null);
    setActive(initialPane(channel, canManageChannel));
  }

  const current = draft ?? channel;
  const text = current?.kind !== "voice";
  const navigation = navigationFor(current?.kind ?? "text", canManageChannel, t);
  const items = navigation.flatMap((group) => group.items);
  // A closed dialog for a regular member can briefly have no channel: its
  // initial pane is `general`, but the only pane it may show is notifications.
  // The fallback is written back so a later permission change keeps the pane
  // on screen instead of reviving the stale one; once written it matches
  // `active`, so this settles after a single extra render.
  const selected = items.find((item) => item.key === active) ?? items[0];
  const resolvedActive = selected?.key ?? "notifications";
  if (resolvedActive !== active) setActive(resolvedActive);

  useEffect(() => {
    if (panesRef.current) panesRef.current.scrollTop = 0;
  }, [resolvedActive]);

  const channelLabel =
    current === null
      ? t("channel.channel")
      : `${current.kind === "voice" ? "" : "#"}${current.name}`;
  const channelIcon: IconName = text ? "hash" : "speaker";

  const dirty =
    current !== null &&
    channel !== null &&
    (current.name.trim() !== channel.name ||
      current.topic.trim() !== channel.topic ||
      current.slowModeSeconds !== channel.slowModeSeconds ||
      current.hideAfterInactivityHours !== channel.hideAfterInactivityHours ||
      current.userLimit !== channel.userLimit);

  const patch = (part: Partial<ChannelSettingsVM>) => {
    setDraft((value) => (value === null ? value : { ...value, ...part }));
  };

  const save = async () => {
    if (current === null || !supported) return;
    setSaving(true);
    setActionError(null);
    try {
      await onSave({
        name: current.name.trim(),
        hideAfterInactivityHours: current.hideAfterInactivityHours,
        ...(current.kind === "voice"
          ? { userLimit: current.userLimit }
          : {
              topic: current.topic.trim(),
              slowModeSeconds: current.slowModeSeconds,
            }),
      });
    } catch {
      setActionError(t("channel.settingsSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await onDelete();
    } catch {
      setActionError(t("channel.deleteFailed"));
      setConfirming(true);
    } finally {
      setSaving(false);
    }
  };

  const pane = () => {
    switch (resolvedActive) {
      case "general":
        return <GeneralPane current={current} supported={supported} patch={patch} t={t} />;
      case "voice":
        return <VoicePane current={current} supported={supported} patch={patch} t={t} />;
      case "notifications":
        return (
          <NotificationsPane
            muted={notificationMuted}
            onMutedChange={onNotificationMutedChange}
            t={t}
          />
        );
      case "permissions":
        return (
          <PermissionsPane
            roles={roles}
            permissionsSupported={permissionsSupported}
            permissionOverrides={permissionOverrides}
            onSavePermissionOverride={onSavePermissionOverride}
            onOpenRoles={onOpenRoles}
            t={t}
          />
        );
      case "danger":
        return (
          <DangerPane
            current={current}
            supported={supported}
            confirming={confirming}
            setConfirming={setConfirming}
            onDelete={() => void remove()}
            t={t}
          />
        );
    }
  };

  // Notifications are this member's own setting, so only the administrative
  // panes can be read-only.
  const activeSupported = resolvedActive === "notifications" || supported;

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} className="sv-wrap">
      <div className="sv ch-settings">
        <div className="sv-bar">
          <div className="sv-bar-txt">
            <h2>{selected?.label}</h2>
            <p>{selected?.detail}</p>
          </div>
          <div className="sv-close">
            <button
              type="button"
              className="sv-x"
              aria-label={t("common.closeChannelSettings")}
              onClick={onClose}
            >
              <Icon name="x" size={18} />
            </button>
            <span>ESC</span>
          </div>
        </div>

        <aside className="sv-nav">
          <div className="sv-brand ch-settings-brand">
            <span className="ch-settings-mark" aria-hidden="true">
              <Icon name={channelIcon} size={20} />
            </span>
            <span className="sv-brand-txt">
              <b id={titleId} aria-label={t("channel.settingsLabel", { name: channelLabel })}>
                {channelLabel}
              </b>
              <span>{text ? t("channel.text") : t("channel.voice")}</span>
            </span>
          </div>
          <nav className="sv-nav-scroll" aria-label={t("channel.settingsSections")}>
            {navigation.map((group) => (
              <Fragment key={group.caption}>
                <div className="sv-cap">{group.caption}</div>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`sv-item${item.key === resolvedActive ? " on" : ""}${item.danger ? " danger" : ""}`}
                    aria-current={item.key === resolvedActive ? "page" : undefined}
                    onClick={() => setActive(item.key)}
                  >
                    <span className="sv-ico" aria-hidden="true">
                      <Icon name={item.icon} size={18} />
                    </span>
                    {item.label}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>
        </aside>

        <div className="sv-main">
          <div className="sv-panes" ref={panesRef}>
            <section className="sv-pane on" data-pane={resolvedActive} key={resolvedActive}>
              {activeSupported ? null : <p className="set-note">{t("channel.settingsUnsupported")}</p>}
              {pane()}
            </section>
          </div>
          <footer className="ch-settings-foot">
            {actionError === null ? null : (
              <span className="frm-detail-error" role="alert">
                {actionError}
              </span>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>
              <Icon name="x" size={15} />
              {t("common.close")}
            </button>
            {resolvedActive === "notifications" ? null : (
              <button
                type="button"
                className="btn-primary"
                disabled={!supported || !dirty || current === null || saving}
                onClick={() => void save()}
              >
                <Icon name="tick" size={15} />
                {saving ? t("common.saving") : t("channel.settingsSave")}
              </button>
            )}
          </footer>
        </div>
      </div>
    </Modal>
  );
}
