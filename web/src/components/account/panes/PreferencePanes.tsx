"use client";

import type { ReactNode } from "react";

import type { IconName } from "@stellarr/ui/icons";
import { Switch } from "@/components/primitives/Switch";
import type { UserPreferences } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { VoiceSection } from "./VoiceFields";

/**
 * The switch panes: notifications, privacy and advanced.
 *
 * They share one shape, a card of switches each with a sentence saying what it
 * changes, so they share this file and its row.
 */

export interface PreferencePaneProps {
  preferences: UserPreferences;
  /** False while the backend cannot store preferences: the switches stay read-only. */
  supported: boolean;
  onChange: (patch: Partial<UserPreferences>) => void;
}

/** Desktop notifications are a browser permission, not a stored preference alone. */
export interface SystemNotificationPreferenceProps {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  pending: boolean;
  error: boolean;
  onChange(enabled: boolean): void;
}

/** Starting with the operating system, offered only by the native client. */
export interface StartupPreferenceProps {
  enabled: boolean;
  pending: boolean;
  error: boolean;
  onChange: (enabled: boolean) => void;
}

interface PreferenceRowProps {
  label: string;
  detail: string;
  /** Why the last change did not take. */
  error?: string | null;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function PreferenceRow({ label, detail, error, checked, disabled, onChange }: PreferenceRowProps) {
  return (
    <div className="frm-row">
      <span className="frm-lab">
        {label}
        <span>{detail}</span>
        {error ? <span className="frm-detail-error" role="alert">{error}</span> : null}
      </span>
      <div className="frm-ctl frm-switch">
        <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      </div>
    </div>
  );
}

function SwitchCard({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <VoiceSection icon={icon} title={title}>
      <div className="frm">{children}</div>
    </VoiceSection>
  );
}

function UnsavedNote({ supported }: { supported: boolean }) {
  const { t } = useLanguage();
  return supported ? null : <p className="set-note">{t("preference.unsaved")}</p>;
}

export function UserNotificationsPane({
  preferences,
  supported,
  onChange,
  systemNotifications,
}: PreferencePaneProps & { systemNotifications?: SystemNotificationPreferenceProps }) {
  const { t } = useLanguage();

  const systemDetail =
    systemNotifications?.permission === "denied"
      ? t("preference.desktopNotificationsDenied")
      : systemNotifications?.supported === false
        ? t("preference.desktopNotificationsUnsupported")
        : t("preference.desktopNotificationsDetail");

  return (
    <>
      <UnsavedNote supported={supported} />
      <SwitchCard title={t("preference.notifications")} icon="bell">
        {systemNotifications === undefined ? null : (
          <PreferenceRow
            label={t("preference.desktopNotifications")}
            detail={systemDetail}
            error={systemNotifications.error ? t("preference.desktopNotificationsFailed") : null}
            checked={
              systemNotifications.permission === "granted" && preferences.desktopNotifications
            }
            disabled={!supported || !systemNotifications.supported || systemNotifications.pending}
            onChange={systemNotifications.onChange}
          />
        )}
        <PreferenceRow
          label={t("preference.messageSound")}
          detail={t("preference.messageSoundDetail")}
          checked={preferences.messageSound}
          disabled={!supported}
          onChange={(messageSound) => onChange({ messageSound })}
        />
        {/* One switch covers both halves of a comings-and-goings sound: the
            shared chime and the clip someone chose for their own arrival
            announce the same event, so "do I want to hear that" has one answer. */}
        <PreferenceRow
          label={t("preference.joinLeaveSound")}
          detail={t("preference.joinLeaveSoundDetail")}
          checked={preferences.joinLeaveSound}
          disabled={!supported}
          onChange={(joinLeaveSound) => onChange({ joinLeaveSound })}
        />
      </SwitchCard>
    </>
  );
}

export function PrivacyPane({ preferences, supported, onChange }: PreferencePaneProps) {
  const { t } = useLanguage();
  return (
    <>
      <UnsavedNote supported={supported} />
      <SwitchCard title={t("preference.privacySecurity")} icon="shield">
        {/* The details say what turning a switch off takes away, because the
            off side is the one with consequences. */}
        <PreferenceRow
          label={t("preference.directMessages")}
          detail={t("preference.directMessagesDetail")}
          checked={preferences.allowDirectMessages}
          disabled={!supported}
          onChange={(allowDirectMessages) => onChange({ allowDirectMessages })}
        />
        <PreferenceRow
          label={t("preference.friendRequests")}
          detail={t("preference.friendRequestsDetail")}
          checked={preferences.allowFriendRequests}
          disabled={!supported}
          onChange={(allowFriendRequests) => onChange({ allowFriendRequests })}
        />
        <PreferenceRow
          label={t("preference.showPresence")}
          detail={t("preference.showPresenceDetail")}
          checked={preferences.showPresence}
          disabled={!supported}
          onChange={(showPresence) => onChange({ showPresence })}
        />
      </SwitchCard>
    </>
  );
}

export function AdvancedPane({
  preferences,
  supported,
  onChange,
  startup,
}: PreferencePaneProps & { startup?: StartupPreferenceProps }) {
  const { t } = useLanguage();
  return (
    <>
      {startup === undefined ? null : (
        // Autostart lives in the operating system, not in the stored
        // preferences, so it works even when those are read-only.
        <SwitchCard title={t("preference.system")} icon="gear">
          <PreferenceRow
            label={t("preference.startup")}
            detail={t("preference.startupDetail")}
            error={startup.error ? t("preference.startupFailed") : null}
            checked={startup.enabled}
            disabled={startup.pending}
            onChange={startup.onChange}
          />
        </SwitchCard>
      )}
      <UnsavedNote supported={supported} />
      <SwitchCard title={t("preference.advanced")} icon="sliders">
        <PreferenceRow
          label={t("preference.developerMode")}
          detail={t("preference.developerModeDetail")}
          checked={preferences.developerMode}
          disabled={!supported}
          onChange={(developerMode) => onChange({ developerMode })}
        />
        <PreferenceRow
          label={t("preference.reducedMotion")}
          detail={t("preference.reducedMotionDetail")}
          checked={preferences.reducedMotion}
          disabled={!supported}
          onChange={(reducedMotion) => onChange({ reducedMotion })}
        />
      </SwitchCard>
      <p className="set-note">{t("preference.reducedMotionNote")}</p>
    </>
  );
}
