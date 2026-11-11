"use client";

import type { IconName } from "@/components/icons/Icon";
import { ErrorNotice, type ErrorNoticeAction } from "@/components/primitives/ErrorNotice";
import { useLanguage, useUi, useVoice, type VoiceValue } from "@/state/hooks";

type ProblemKind = NonNullable<VoiceValue["problem"]>["kind"];

function iconFor(kind: ProblemKind): IconName {
  switch (kind) {
    case "camera":
      return "camera";
    case "mic-denied":
    case "mic-unavailable":
      return "micSlash";
    case "screen-share":
      return "screencast";
    case "session-replaced":
      return "phoneX";
    default:
      return "wifi";
  }
}

/**
 * What went wrong with the call, in the room it affects, and the way out of
 * it. A failed sub-action (camera, screen share) offers to try again; a lost
 * connection offers to reconnect; a call someone else took over offers nothing.
 */
export function VoiceProblemNotice() {
  const voice = useVoice();
  const ui = useUi();
  const { t } = useLanguage();
  const { problem, channelId } = voice;
  if (problem === null) return null;

  const openDeviceSettings = () => ui.openModal("voice");
  const reconnect = () => {
    if (channelId === null) return;
    if (voice.state.connection === "failed") {
      voice.join(channelId);
      return;
    }
    // Still seated: repair the call in place, so the others never see this
    // person leave and come back.
    voice.reconnect();
  };

  const actions: ErrorNoticeAction[] = [];
  switch (problem.kind) {
    case "camera":
      if (voice.call?.cameraOn !== true) {
        actions.push({ label: t("room.retry"), onClick: voice.toggleCamera });
      }
      actions.push({ label: t("room.cameraSettings"), onClick: openDeviceSettings });
      break;
    case "mic-denied":
    case "mic-unavailable":
      // A microphone that can be fixed without leaving needs no new call.
      if (!problem.recoverable && channelId !== null) {
        actions.push({ label: t("room.joinAgain"), onClick: reconnect });
      }
      actions.push({ label: t("room.micSettings"), onClick: openDeviceSettings });
      break;
    case "screen-share":
      if (!voice.localShare) {
        actions.push({ label: t("room.retry"), onClick: voice.toggleShare });
      }
      actions.push({ label: t("room.qualitySettings"), onClick: openDeviceSettings });
      break;
    case "ice-config":
    case "signaling":
    case "transport":
      if (channelId !== null) {
        actions.push({ label: t("room.reconnect"), onClick: reconnect });
      }
      break;
  }

  return (
    <div
      className={
        problem.kind === "session-replaced"
          ? "voice-problem-slot centered"
          : "voice-problem-slot"
      }
    >
      <ErrorNotice
        title={problem.title}
        message={problem.message}
        icon={iconFor(problem.kind)}
        actions={actions}
      />
    </div>
  );
}
