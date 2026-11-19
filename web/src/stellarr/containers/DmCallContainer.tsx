import { useSyncExternalStore } from "react";

import { DmCallView } from "@/components/friends/DmCallView";
import type { CallVM, PersonVM } from "@/components/view-models";
import { VoiceControlBar } from "@/components/voice/VoiceControlBar";
import { CALL_HEADLINE } from "@/components/voice/VoiceDock";
import type { MessageKey } from "@/i18n";
import {
  useFriends,
  useLanguage,
  usePorts,
  useProfile,
  useSession,
  useUi,
  useVoice,
} from "@/state/hooks";

import { toPerson } from "./toPerson";
import { VoiceProblemNotice } from "./VoiceProblemNotice";

/** States in which the call is not up, said in place of its duration. */
const NOT_UP: ReadonlySet<CallVM["headline"]> = new Set([
  "requesting-mic",
  "connecting",
  "reconnecting",
  "failed",
]);

interface DmCallContainerProps {
  /** The element full screen is asked of: the whole room, as on a channel. */
  fullscreenTarget: () => HTMLElement | null;
}

/**
 * The open conversation's call, while you are in it: the other person, you,
 * what either of you shares, and the controls.
 */
export function DmCallContainer({ fullscreenTarget }: DmCallContainerProps) {
  const voice = useVoice();
  const ui = useUi();
  const friends = useFriends();
  const profile = useProfile();
  const ports = usePorts();
  const { user } = useSession();
  const { t } = useLanguage();

  // The device settings straight from the store the pipelines read, as the
  // channel call's bar has them.
  const settings = useSyncExternalStore(
    ports.voiceSettings.subscribe,
    ports.voiceSettings.getSnapshot,
    ports.voiceSettings.getSnapshot,
  );

  const conversation = friends.active;
  if (conversation === null || user === null) return null;

  // The call lists the person before they join; what it knows of their voice
  // is laid over the conversation's own picture of them.
  const heard = voice.people.find((person) => person.id === conversation.peer.id);
  const peer: PersonVM = {
    ...toPerson(conversation.peer),
    speaking: heard?.speaking,
    muted: heard?.muted,
    ...(heard?.undecryptable === undefined ? {} : { undecryptable: heard.undecryptable }),
  };
  const selfSpeaking = voice.people.find((person) => person.id === user.id)?.speaking;
  // Your own face from the session: the call's own entry for you has none.
  const self: PersonVM = { ...toPerson(user), speaking: selfSpeaking, muted: voice.state.muted };

  const { call } = voice;
  const statusKey: MessageKey | null =
    call === null ? "shell.voiceConnecting" : NOT_UP.has(call.headline) ? CALL_HEADLINE[call.headline] : null;
  const openDeviceSettings = () => ui.openModal("voice");

  return (
    <DmCallView
      peer={peer}
      self={self}
      ringing={friends.ringing}
      since={call?.startedAt ?? null}
      {...(statusKey === null ? {} : { status: t(statusKey) })}
      encrypted={voice.state.encrypted}
      share={voice.share}
      localShare={voice.localShare}
      onWatchShare={voice.watchShare}
      onStopWatchingShare={voice.stopWatchingShare}
      cinema={ui.cinema}
      cameraStreams={voice.cameraStreams}
      heldCameras={voice.heldCameras}
      localPersonId={user.id}
      participantVolumes={voice.participantVolumes}
      onParticipantVolumeChange={voice.setParticipantVolume}
      participantGates={voice.participantGates}
      onParticipantGateChange={voice.setParticipantGate}
      participantSuppressions={voice.participantSuppressions}
      onParticipantSuppressionChange={voice.setParticipantSuppression}
      onOpenProfile={profile.toggle}
      notice={<VoiceProblemNotice />}
      bar={
        // No invitation and no pop-out: the call belongs to the two of you
        // and to this conversation. No soundboard either, which private
        // calls do not play.
        <VoiceControlBar
          muted={voice.state.muted}
          deafened={call?.deafened ?? false}
          cameraOn={call?.cameraOn ?? false}
          cameraPending={voice.state.cameraPending}
          sharing={voice.localShare}
          cinema={ui.cinema}
          settings={settings}
          onChangeSettings={(patch) => ports.voiceSettings.update(patch)}
          cameraSupported={voice.cameraSupported}
          fullscreenTarget={fullscreenTarget}
          onToggleMute={voice.toggleMute}
          onToggleDeafen={voice.toggleDeafen}
          onToggleCamera={voice.toggleCamera}
          onSelectMicrophone={openDeviceSettings}
          onSelectCamera={openDeviceSettings}
          onToggleShare={voice.toggleShare}
          onToggleCinema={ui.toggleCinema}
          onLeave={ui.leaveCall}
        />
      }
    />
  );
}
