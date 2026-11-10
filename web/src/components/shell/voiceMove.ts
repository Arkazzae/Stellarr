import type { KeyboardCoordinateGetter } from "@dnd-kit/core";

import type { PersonVM } from "@/components/view-models";

/** What a seated person carries while being dragged to another voice channel. */
export interface VoiceDragData {
  type: "voice-occupant";
  person: PersonVM;
  sourceChannelId: string;
}

/** What a voice channel offers to whatever is dropped on it. */
export interface VoiceDropData {
  type: "voice-channel";
  channelId: string;
}

export function isVoiceDragData(value: unknown): value is VoiceDragData {
  if (typeof value !== "object" || value === null) return false;
  return (value as Partial<VoiceDragData>).type === "voice-occupant";
}

export function isVoiceDropData(value: unknown): value is VoiceDropData {
  if (typeof value !== "object" || value === null) return false;
  return (value as Partial<VoiceDropData>).type === "voice-channel";
}

/** Droppable id of a voice channel; the keyboard sensor looks rows up by it. */
export function voiceDropId(channelId: string): string {
  return `voice-channel:${channelId}`;
}

/**
 * The move a drop asks for, or null when the pair is not an occupant over a
 * different voice channel.
 */
export function voiceMoveRequest(activeData: unknown, overData: unknown) {
  if (!isVoiceDragData(activeData) || !isVoiceDropData(overData)) return null;
  if (activeData.sourceChannelId === overData.channelId) return null;
  return {
    userId: activeData.person.id,
    displayName: activeData.person.displayName,
    sourceChannelId: activeData.sourceChannelId,
    targetChannelId: overData.channelId,
  };
}

/** Arrow keys jump between whole channel targets instead of moving 25 px. */
export const voiceKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
  event.preventDefault();
  const targets = [...context.droppableRects.entries()]
    .map(([id, rect]) => ({ id, rect }))
    .sort((a, b) => a.rect.top - b.rect.top);
  if (targets.length === 0) return currentCoordinates;

  const activeData = context.active?.data.current;
  const sourceId = isVoiceDragData(activeData)
    ? voiceDropId(activeData.sourceChannelId)
    : null;
  const currentIndex = targets.findIndex(({ id }) =>
    context.over !== null ? id === context.over.id : id === sourceId,
  );
  const delta = event.code === "ArrowDown" ? 1 : -1;
  const nextIndex = Math.min(
    targets.length - 1,
    Math.max(0, (currentIndex === -1 ? 0 : currentIndex) + delta),
  );
  const next = targets[nextIndex]?.rect;
  if (next === undefined) return currentCoordinates;
  return { x: next.left, y: next.top };
};
