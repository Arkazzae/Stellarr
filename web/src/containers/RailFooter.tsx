"use client";

import { useSyncExternalStore } from "react";

import { AccountRow } from "@/components/shell/AccountRow";
import { VoiceDock } from "@/components/shell/VoiceDock";
import type { PersonVM } from "@/components/view-models";
import { initials } from "@/lib/format";
import {
  useAccount,
  useEmoji,
  usePorts,
  useSession,
  useUi,
  useVoice,
} from "@/state/hooks";

/** Stands in until the boot payload lands; a rail renders one frame before it. */
const UNKNOWN_SELF: PersonVM = {
  id: "",
  displayName: "…",
  initials: "?",
  presence: "offline",
};

/**
 * The bottom of the rail, whichever rail is on screen.
 *
 * A call and the account row belong to the session, not to the server side of
 * the app: leaving a call has to stay reachable from a conversation, and the
 * two rails would drift apart the first time one of them was edited alone.
 */
export function RailVoiceDock() {
  const ui = useUi();
  const voice = useVoice();
  const { voiceSettings } = usePorts();
  const settings = useSyncExternalStore(
    voiceSettings.subscribe,
    voiceSettings.getSnapshot,
    voiceSettings.getSnapshot,
  );

  return (
    <VoiceDock
      call={voice.call}
      sounds={voice.sounds}
      soundboardSupported={voice.soundboardEnabled}
      soundboardVolume={settings.soundboardVolume}
      onChangeSoundboardVolume={(soundboardVolume) =>
        voiceSettings.update({ soundboardVolume })
      }
      cameraSupported={voice.cameraSupported}
      noiseSuppression={settings.noiseSuppression}
      onChangeNoiseSuppression={(noiseSuppression) =>
        voiceSettings.update({ noiseSuppression })
      }
      onToggleMute={voice.toggleMute}
      onToggleDeafen={voice.toggleDeafen}
      onToggleCamera={voice.toggleCamera}
      onToggleShare={voice.toggleShare}
      onLeave={ui.leaveCall}
      onPlaySound={voice.playSound}
      onReturnToChannel={ui.returnToChannel}
    />
  );
}

export function RailAccount() {
  const { user, presence, presenceSupported, setPresence, logout } = useSession();
  const ui = useUi();
  const { emoji: customEmoji } = useEmoji();
  const { account, supported, update } = useAccount();

  // The presence is the status you chose, not the one the socket implies: this
  // row is where you read back what you set.
  const self: PersonVM =
    user === null
      ? UNKNOWN_SELF
      : {
          id: user.id,
          displayName: user.displayName,
          initials: initials(user.displayName),
          presence,
          ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
        };

  const openSettings = () => ui.openModal("account");

  return (
    <AccountRow
      user={self}
      onOpenSettings={openSettings}
      onOpenMessages={ui.openFriends}
      panel={{
        presence,
        presenceSupported,
        customStatus: account.customStatus,
        customStatusSupported: supported.profile,
        customEmoji,
        onSetPresence: setPresence,
        onSaveCustomStatus: (customStatus) => {
          void update({ customStatus }).catch(() => undefined);
        },
        onOpenSettings: openSettings,
        onLogout: () => {
          void logout();
        },
      }}
    />
  );
}
