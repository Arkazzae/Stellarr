"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  useDroppable,
  useSensor,
  useSensors,
  KeyboardSensor,
  PointerSensor,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import type { MouseEventHandler, ReactNode } from "react";
import { createPortal } from "react-dom";

import { Avatar } from "@/components/primitives/Avatar";
import { ChannelButton } from "@/components/shell/ChannelButton";
import type { ChannelMenuRaiser } from "@/components/shell/railTypes";
import type { VoiceMove } from "@/components/shell/useVoiceMove";
import { VoiceOccupantRow } from "@/components/shell/VoiceOccupantRow";
import {
  isVoiceDragData,
  isVoiceDropData,
  voiceDropId,
  voiceKeyboardCoordinates,
  type VoiceDropData,
} from "@/components/shell/voiceMove";
import type { PersonVM, VoiceChannelVM } from "@/components/view-models";
import { useLanguage } from "@/state/hooks";

function VoiceDropZone({
  channelId,
  disabled,
  children,
}: {
  channelId: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: voiceDropId(channelId),
    disabled,
    data: { type: "voice-channel", channelId } satisfies VoiceDropData,
  });
  return (
    <div
      ref={setNodeRef}
      className={isOver ? "voice-channel-drop is-over" : "voice-channel-drop"}
    >
      {children}
    </div>
  );
}

export interface RailVoiceListProps {
  channels: VoiceChannelVM[];
  activeChannelId: string | null;
  /** Whose occupant row gets `.me`. */
  selfId: string;
  /** The move in progress, shared by every list in the rail. */
  move: VoiceMove;
  /** Whether staff may move people between channels. */
  canMove: boolean;
  onJoin: (channelId: string) => void;
  /** Already gated on who may edit; absent hides the cog. */
  onOpenSettings?: (channelId: string) => void;
  menuFor?: ChannelMenuRaiser;
  personMenuFor?: (person: PersonVM) => MouseEventHandler<HTMLElement>;
}

/**
 * The voice channels of one rail group, each with the people seated under it.
 *
 * Every list has its own drag context, so a group collapsing or a section
 * being empty never leaves a drop target behind; the shared move state is
 * what ties them together. The overlay is painted only by the list that owns
 * the channel being dragged from.
 */
export function RailVoiceList({
  channels,
  activeChannelId,
  selfId,
  move,
  canMove,
  onJoin,
  onOpenSettings,
  menuFor,
  personMenuFor,
}: RailVoiceListProps) {
  const { t } = useLanguage();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: voiceKeyboardCoordinates }),
  );
  const { dragged } = move;
  const showOverlay =
    dragged !== null &&
    channels.some((channel) => channel.id === dragged.sourceChannelId);
  const nameOf = (channelId: string) =>
    channels.find((channel) => channel.id === channelId)?.name;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{
        screenReaderInstructions: { draggable: t("shell.dragInstructions") },
        announcements: {
          onDragStart: ({ active }) => {
            const data = active.data.current;
            return isVoiceDragData(data)
              ? t("shell.dragLifted", { name: data.person.displayName })
              : undefined;
          },
          onDragOver: ({ over }) => {
            const data = over?.data.current;
            if (!isVoiceDropData(data)) return;
            const name = nameOf(data.channelId);
            return name === undefined ? undefined : t("shell.dragOver", { name });
          },
          onDragEnd: ({ active, over }) => {
            const drag = active.data.current;
            const drop = over?.data.current;
            if (!isVoiceDragData(drag) || !isVoiceDropData(drop)) {
              return t("shell.dragCancelled");
            }
            const name = nameOf(drop.channelId);
            return name === undefined
              ? t("shell.dragCancelled")
              : t("shell.dragDropped", {
                  user: drag.person.displayName,
                  channel: name,
                });
          },
          onDragCancel: () => t("shell.dragCancelled"),
        },
      }}
      onDragStart={move.onDragStart}
      onDragCancel={move.onDragCancel}
      onDragEnd={move.onDragEnd}
    >
      {channels.map((channel) => {
        const count = channel.occupants.length;
        return (
          <VoiceDropZone key={channel.id} channelId={channel.id} disabled={!canMove}>
            <ChannelButton
              kind="voice"
              name={channel.name}
              active={channel.id === activeChannelId}
              count={count}
              countLabel={t("shell.peopleInCall", { count })}
              onOpenSettings={
                onOpenSettings === undefined
                  ? undefined
                  : () => onOpenSettings(channel.id)
              }
              onSelect={() => onJoin(channel.id)}
              onContextMenu={menuFor?.({
                id: channel.id,
                kind: "voice",
                name: channel.name,
                unread: 0,
                sectionId: channel.sectionId,
              })}
            />
            <ul className="voice-occupants">
              {channel.occupants.map((person) => (
                <VoiceOccupantRow
                  key={person.id}
                  person={person}
                  sourceChannelId={channel.id}
                  self={person.id === selfId}
                  draggable={canMove}
                  moving={move.movingUserId === person.id}
                  onContextMenu={personMenuFor?.(person)}
                />
              ))}
            </ul>
          </VoiceDropZone>
        );
      })}
      {typeof document === "undefined"
        ? null
        : createPortal(
            <DragOverlay dropAnimation={null}>
              {showOverlay ? (
                <div className="voice-occupant-overlay">
                  <Avatar
                    id={dragged.person.id}
                    displayName={dragged.person.displayName}
                    initials={dragged.person.initials}
                    avatarUrl={dragged.person.avatarUrl}
                    size="xs"
                  />
                  <span>{dragged.person.displayName}</span>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
    </DndContext>
  );
}
