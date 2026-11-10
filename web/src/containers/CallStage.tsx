"use client";

import { useSyncExternalStore } from "react";

import { VoiceControlBar } from "@/components/voice/VoiceControlBar";
import { VoiceStage } from "@/components/voice/VoiceStage";
import {
  useDirectory,
  usePorts,
  useProfile,
  useSession,
  useUi,
  useVoice,
} from "@/state/hooks";

import { popOutCall } from "./callPopout";
import { VoiceProblemNotice } from "./VoiceProblemNotice";

interface CallStageProps {
  /** The element full screen is asked of: the whole room, not just the stage. */
  fullscreenTarget: () => HTMLElement | null;
}

/** The call's own view of the room: who is in it, what is shared, and the controls. */
export function CallStage({ fullscreenTarget }: CallStageProps) {
  const voice = useVoice();
  const ui = useUi();
  const profile = useProfile();
  const { user } = useSession();
  const { canManageServer } = useDirectory();
  const ports = usePorts();

  // The device settings straight from the store the pipelines read, so what
  // the bar's arrows edit is what the call is running on.
  const settings = useSyncExternalStore(
    ports.voiceSettings.subscribe,
    ports.voiceSettings.getSnapshot,
    ports.voiceSettings.getSnapshot,
  );

  // Device pickers live in the voice settings dialog. The server's own dialog
  // is the wrong place: the microphone arrow once raised roles and invites.
  const openDeviceSettings = () => ui.openModal("voice");
  const joinedChannelId = voice.channelId;

  return (
    <>
      <VoiceProblemNotice />
      <VoiceStage
        people={voice.people}
        cameraStreams={voice.cameraStreams}
        localPersonId={user?.id ?? ""}
        participantVolumes={voice.participantVolumes}
        onParticipantVolumeChange={voice.setParticipantVolume}
        participantGates={voice.participantGates}
        onParticipantGateChange={voice.setParticipantGate}
        participantSuppressions={voice.participantSuppressions}
        onParticipantSuppressionChange={voice.setParticipantSuppression}
        onOpenProfile={profile.toggle}
        share={voice.share}
        localShare={voice.localShare}
        onWatchShare={voice.watchShare}
        onStopWatchingShare={voice.stopWatchingShare}
        cinema={ui.cinema}
      />
      <VoiceControlBar
        muted={voice.state.muted}
        cameraOn={voice.call?.cameraOn ?? false}
        cameraPending={voice.state.cameraPending}
        sharing={voice.localShare}
        cinema={ui.cinema}
        sounds={voice.sounds}
        soundboardSupported={voice.soundboardEnabled}
        settings={settings}
        onChangeSettings={(patch) => ports.voiceSettings.update(patch)}
        cameraSupported={voice.cameraSupported}
        fullscreenTarget={fullscreenTarget}
        onToggleMute={voice.toggleMute}
        onToggleCamera={voice.toggleCamera}
        onSelectMicrophone={openDeviceSettings}
        onSelectCamera={openDeviceSettings}
        onToggleShare={voice.toggleShare}
        onPlaySound={voice.playSound}
        onInvite={canManageServer ? () => ui.openModal("invite") : undefined}
        onToggleCinema={ui.toggleCinema}
        onLeave={ui.leaveCall}
        onPopOut={() => {
          if (joinedChannelId !== null) popOutCall(joinedChannelId);
        }}
      />
    </>
  );
}
