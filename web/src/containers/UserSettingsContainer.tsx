"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { UserSettings } from "@/components/account/UserSettings";
import { useBrowserNotifications } from "@/hooks/useBrowserNotifications";
import type { UserPreferences } from "@/ports";
import {
  useAccount,
  useEmoji,
  useFriends,
  useKeybinds,
  useLanguage,
  usePorts,
  useSession,
  useTheme,
  useUi,
} from "@/state/hooks";

import { useAutostart } from "./useAutostart";
import { useCameraTest } from "./useCameraTest";
import { useJoinSound } from "./useJoinSound";
import { useMicTest } from "./useMicTest";
import { useOutputTest } from "./useOutputTest";
import { SecurityStepDialog } from "@/components/account/panes/SecurityStepDialog";

import { useAccountSecurity } from "./useAccountSecurity";

/**
 * The user settings dialog, assembled.
 *
 * Three owners meet here and none of them knows about the other two: the
 * account port holds the profile and the preferences, `ThemeProvider` holds
 * the theme on this device, and the voice settings live in their own store
 * because the audio pipeline reads them while a call is running.
 */
export function UserSettingsContainer() {
  const ports = usePorts();
  const ui = useUi();
  const account = useAccount();
  const { emoji: customEmoji } = useEmoji();
  const friends = useFriends();
  const session = useSession();
  const language = useLanguage();
  const keybinds = useKeybinds();
  const browserNotifications = useBrowserNotifications();
  const { theme, resolved, update: updateTheme, reset: resetTheme } = useTheme();
  const { autostart, setEnabled: setAutostartEnabled } = useAutostart(ports.desktop);

  const voiceSettings = useSyncExternalStore(
    ports.voiceSettings.subscribe,
    ports.voiceSettings.getSnapshot,
    ports.voiceSettings.getSnapshot,
  );

  // Sensitivity is applied from the local store so a running call reacts at
  // once, but the account owns it durably and restores it on another device.
  // This is the value the account is known to hold or to be about to hold.
  const requestedVad = useRef(account.preferences.vadSensitivity);
  useEffect(() => {
    requestedVad.current = account.preferences.vadSensitivity;
    ports.voiceSettings.update({ vadSensitivity: account.preferences.vadSensitivity });
  }, [account.preferences.vadSensitivity, ports.voiceSettings]);

  const persistVad = (vadSensitivity: number) => {
    requestedVad.current = vadSensitivity;
    void account.setPreferences({ vadSensitivity }).catch(() => {
      // The account did not take it, so the live value goes back to the one it has.
      const stored = account.preferences.vadSensitivity;
      requestedVad.current = stored;
      ports.voiceSettings.update({ vadSensitivity: stored });
    });
  };

  const persistPreferences = (patch: Partial<UserPreferences>) => {
    void account.setPreferences(patch).catch(() => undefined);
  };

  const changeSystemNotifications = (enabled: boolean) => {
    if (!enabled) {
      persistPreferences({ desktopNotifications: false });
      return;
    }
    // The permission prompt has to start in this switch's click, and the
    // preference is stored only once the browser confirms it can deliver.
    void browserNotifications
      .request()
      .then((granted) =>
        granted ? account.setPreferences({ desktopNotifications: true }) : undefined,
      )
      .catch(() => undefined);
  };

  // The account row, "edit profile" on the card and the voice bar's device
  // pickers all land in this one dialog.
  const open =
    ui.modal === "account" || ui.modal === "profile" || ui.modal === "voice";

  // Opening a device is a transport, and a component may not reach past
  // `@/ports` to do it, so the microphone, speaker and camera tests live here.
  const mic = useMicTest(voiceSettings);
  const output = useOutputTest(voiceSettings);
  const camera = useCameraTest(voiceSettings);
  const joinSound = useJoinSound(open);
  const accountSecurity = useAccountSecurity(open);

  return (
    <>
      <UserSettings
        open={open}
        onClose={ui.closeModal}
        // Only the voice bar lands on a different pane: the profile is the
        // account pane.
        initialPane={ui.modal === "voice" ? "glos" : "konto"}
        account={account.account}
        accountPane={{
          customEmoji,
          onSave: (patch) => account.update(patch),
          onPickImage: account.setImage,
          onRemoveImage: account.removeImage,
          joinSound,
        }}
        security={{
          // The new address proves it receives mail before it replaces the old.
          emailSupported: true,
          twoStep: accountSecurity.sections,
          onChangeEmail: (email, password) => account.requestEmailChange(email, password),
          onChangePassword: account.changePassword,
          onConfirmSecondStep: accountSecurity.confirmSecondStep,
        }}
        preferences={{
          preferences: account.preferences,
          onChange: persistPreferences,
        }}
        blocked={{
          people: friends.blocked.map((person) => ({
            id: person.id,
            displayName: person.displayName,
            username: person.username,
            ...(person.avatarUrl ? { avatarUrl: person.avatarUrl } : {}),
          })),
          onUnblock: friends.unblock,
        }}
        systemNotifications={{
          supported: browserNotifications.supported,
          permission: browserNotifications.permission,
          pending: browserNotifications.pending,
          error: browserNotifications.error,
          onChange: changeSystemNotifications,
        }}
        keybinds={keybinds}
        startup={
          autostart.available
            ? {
                enabled: autostart.enabled,
                pending: autostart.pending,
                error: autostart.error,
                onChange: setAutostartEnabled,
              }
            : undefined
        }
        appearance={{
          theme,
          resolvedScheme: resolved,
          onChange: updateTheme,
          onReset: resetTheme,
          motion: {
            reducedMotion: account.preferences.reducedMotion,
            onChange: (reducedMotion) => persistPreferences({ reducedMotion }),
          },
        }}
        voice={{
          settings: voiceSettings,
          onChange: (patch) => ports.voiceSettings.update(patch),
          onVadCommit: (vadSensitivity) => {
            if (requestedVad.current !== vadSensitivity) persistVad(vadSensitivity);
          },
          onReset: () => {
            ports.voiceSettings.reset();
            persistVad(ports.voiceSettings.getSnapshot().vadSensitivity);
          },
          mic,
          output,
          camera,
        }}
        language={{
          locale: language.locale,
          chatTranslationEnabled: language.chatTranslationEnabled,
          chatAutoTranslateEnabled: language.chatAutoTranslateEnabled,
          chatTranslationTargetLanguage: language.chatTranslationTargetLanguage,
          update: language.update,
          t: language.t,
        }}
        t={language.t}
        onLogout={() => {
          // Closed first: the dialog belongs to a signed-in session, and leaving
          // it over the sign-in screen would trap focus in a dead tree.
          ui.closeModal();
          void session.logout();
        }}
      />
      <SecurityStepDialog
        {...accountSecurity.dialog}
        username={account.account.username}
        t={language.t}
      />
    </>
  );
}
