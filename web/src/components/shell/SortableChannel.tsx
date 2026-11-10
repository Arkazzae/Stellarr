"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  ChannelButton,
  type ChannelButtonProps,
} from "@/components/shell/ChannelButton";

export type SortableChannelProps = Omit<ChannelButtonProps, "drag"> & {
  id: string;
};

/**
 * A channel row registered with the surrounding `@dnd-kit` sortable list.
 *
 * `useSortable` is a hook and rows are rendered in a loop, so each row needs
 * its own component; keeping the library out of `ChannelButton` also leaves
 * that row renderable from plain props.
 */
export function SortableChannel({ id, ...row }: SortableChannelProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <ChannelButton
      {...row}
      drag={{
        setNode: setNodeRef,
        style: {
          // Transform only: the row keeps its box, so the list does not
          // reflow under the pointer while a row is carried.
          transform: CSS.Transform.toString(transform),
          transition,
          ...(isDragging && { position: "relative", zIndex: 1 }),
        },
        dragging: isDragging,
        attributes,
        listeners,
      }}
    />
  );
}
