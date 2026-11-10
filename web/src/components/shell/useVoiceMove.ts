import { useState } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

import {
  isVoiceDragData,
  voiceMoveRequest,
  type VoiceDragData,
} from "@/components/shell/voiceMove";
import { useLanguage } from "@/state/hooks";

export interface VoiceMoveOptions {
  /** Absent leaves occupants as plain rows: nothing can be dropped anywhere. */
  onMove?: (
    userId: string,
    sourceChannelId: string,
    targetChannelId: string,
  ) => Promise<void> | void;
  /** Called with the failure text, or null when a new attempt clears it. */
  onError: (message: string | null) => void;
}

/**
 * The life of one staff move of a person between voice channels: who is being
 * carried, who is waiting for the server to confirm, and the words a screen
 * reader gets at each step.
 */
export function useVoiceMove({ onMove, onError }: VoiceMoveOptions) {
  const { t } = useLanguage();
  const [dragged, setDragged] = useState<VoiceDragData | null>(null);
  const [movingUserId, setMovingUserId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (isVoiceDragData(data)) setDragged(data);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragged(null);
    const move = voiceMoveRequest(
      event.active.data.current,
      event.over?.data.current,
    );
    if (move === null || onMove === undefined) return;

    setMovingUserId(move.userId);
    onError(null);
    setAnnouncement(t("shell.movingUser", { name: move.displayName }));
    void Promise.resolve(
      onMove(move.userId, move.sourceChannelId, move.targetChannelId),
    )
      .then(() => {
        setAnnouncement(t("shell.movedUser", { name: move.displayName }));
      })
      .catch(() => {
        const failed = t("shell.moveFailed", { name: move.displayName });
        onError(failed);
        setAnnouncement(failed);
      })
      .finally(() => setMovingUserId(null));
  };

  return {
    dragged,
    movingUserId,
    announcement,
    onDragStart,
    onDragEnd,
    onDragCancel: () => setDragged(null),
  };
}

export type VoiceMove = ReturnType<typeof useVoiceMove>;
