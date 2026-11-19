import { useSyncExternalStore } from "react";

import { AccountRow } from "@/components/account/AccountRow";
import { VoiceDock } from "@/components/voice/VoiceDock";
import type { PersonVM } from "@/components/view-models";
import { initials } from "@/lib/format/format";
import {
  useAccount,
  useEmoji,
  useFriends,
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
  const { ringing } = useFriends();
  const { voiceSettings, soundboard } = usePorts();
  const settings = useSyncExternalStore(
    voiceSettings.subscribe,
    voiceSettings.getSnapshot,
    voiceSettings.getSnapshot,
  );

  return (
    <VoiceDock
      call={voice.call}
      ringing={ringing}
      sounds={voice.sounds}
      soundboardSupported={voice.soundboardEnabled && voice.soundboard.canPlay}
      soundboardLive={soundboard.live}
      onManageSounds={voice.soundboard.canManage ? () => ui.openModal("soundboard") : undefined}
      soundboardVolume={settings.soundboardVolume}
      onChangeSoundboardVolume={(soundboardVolume) =>
        voiceSettings.update({ soundboardVolume })
      }
      cameraSupported={voice.cameraSupported}
      noiseSuppression={settings.noiseSuppression}
      noiseDownload={voice.suppressorDownload}
      onChangeNoiseSuppression={(noiseSuppression) =>
        voiceSettings.update({ noiseSuppression })
      }
      onToggleMute={voice.toggleMute}
      onToggleDeafen={voice.toggleDeafen}
      onToggleCamera={voice.toggleCamera}
      onToggleShare={voice.toggleShare}
      onLeave={ui.leaveCall}
      // A private call has no soundboard, so the dock offers none.
      onPlaySound={voice.privateCall ? undefined : voice.playSound}
      onReturnToChannel={ui.returnToChannel}
    />
  );
}

export function RailAccount() {
  const { user, presence, setPresence, logout } = useSession();
  const ui = useUi();
  const { emoji: customEmoji } = useEmoji();
  const { account, update } = useAccount();

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

  return (
    <AccountRow
      user={self}
      onOpenSettings={() => ui.openModal("account")}
      panel={{
        presence,
        customStatus: account.customStatus,
        customEmoji,
        onSetPresence: setPresence,
        onSaveCustomStatus: (customStatus) => {
          void update({ customStatus }).catch(() => undefined);
        },
        onLogout: () => {
          void logout();
        },
      }}
    />
  );
}
