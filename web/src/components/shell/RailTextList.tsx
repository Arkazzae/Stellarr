"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { ChannelThreads } from "@/components/shell/ChannelThreads";
import type {
  ChannelMenuRaiser,
  RailThreads,
} from "@/components/shell/railTypes";
import { SortableChannel } from "@/components/shell/SortableChannel";
import type { TextChannelVM } from "@/components/view-models";

/** Moves `id` to sit where `target` currently is. */
function reorder(ids: string[], id: string, target: string): string[] {
  const next = ids.filter((candidate) => candidate !== id);
  const at = next.indexOf(target);
  if (at === -1) return ids;
  next.splice(at, 0, id);
  return next;
}

export interface RailTextListProps {
  channels: TextChannelVM[];
  activeChannelId: string | null;
  threads: RailThreads;
  isMuted?: (channelId: string) => boolean;
  onSelect: (channelId: string) => void;
  /** Already gated on who may edit; absent hides the cog. */
  onOpenSettings?: (channelId: string) => void;
  menuFor?: ChannelMenuRaiser;
  /** The list's complete id order after a drop that changed it. */
  onReorder: (order: string[]) => void;
}

/**
 * The text channels of one rail group, sortable by dragging.
 *
 * The whole row is the handle, which only works because of the activation
 * constraint: a press has to travel 6 px before it counts as a drag, so a
 * click still opens the channel. The keyboard sensor stands in for a grip:
 * Space picks a channel up, the arrows move it, Space drops it (`ChannelButton`
 * keeps Enter for "open").
 */
export function RailTextList({
  channels,
  activeChannelId,
  threads,
  isMuted,
  onSelect,
  onOpenSettings,
  menuFor,
  onReorder,
}: RailTextListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const order = channels.map((channel) => channel.id);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    const next = reorder(order, String(active.id), String(over.id));
    if (next !== order) onReorder(next);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        {channels.map((channel) => {
          const channelThreads = threads.byChannel[channel.id] ?? [];
          const holdsActive = channelThreads.some(
            (thread) => thread.id === threads.activeId,
          );
          const open = threads.expanded.has(channel.id) || holdsActive;
          const threadsId = `channel-threads-${channel.id}`;
          const unread = channel.unread ?? 0;
          return (
            <div className="text-channel-node" key={channel.id}>
              <SortableChannel
                id={channel.id}
                kind="text"
                name={channel.name}
                active={channel.id === activeChannelId && threads.activeId === null}
                unread={unread}
                muted={isMuted?.(channel.id) ?? false}
                threadCount={channelThreads.length}
                threadsOpen={open}
                threadsId={threadsId}
                onToggleThreads={
                  channelThreads.length === 0
                    ? undefined
                    : () => threads.onToggle(channel.id)
                }
                onOpenSettings={
                  onOpenSettings === undefined
                    ? undefined
                    : () => onOpenSettings(channel.id)
                }
                onSelect={() => onSelect(channel.id)}
                onContextMenu={menuFor?.({
                  id: channel.id,
                  kind: "text",
                  name: channel.name,
                  unread,
                  sectionId: channel.sectionId,
                })}
              />
              {channelThreads.length === 0 ? null : (
                <ChannelThreads
                  id={threadsId}
                  channelName={channel.name}
                  threads={channelThreads}
                  open={open}
                  channelActive={channel.id === activeChannelId}
                  activeThreadId={threads.activeId}
                  openingThreadId={threads.openingId}
                  onOpen={threads.onOpen}
                  register={threads.register}
                />
              )}
            </div>
          );
        })}
      </SortableContext>
    </DndContext>
  );
}
