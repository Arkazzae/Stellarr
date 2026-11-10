import type { MouseEventHandler } from "react";

import type { ChannelThreadVM } from "@/components/view-models";

/** What the context menu needs to know about the row it was raised on. */
export interface ChannelMenuTarget {
  id: string;
  kind: "text" | "voice";
  name: string;
  unread: number;
  sectionId?: string;
}

/** Builds the right-click handler of one channel row. */
export type ChannelMenuRaiser = (
  target: ChannelMenuTarget,
) => MouseEventHandler<HTMLElement>;

/** The thread dropdowns under the text channels of every group. */
export interface RailThreads {
  byChannel: Readonly<Record<string, ChannelThreadVM[]>>;
  /** The thread the room is showing, if any. */
  activeId: string | null;
  /** The thread being fetched after a click, if any. */
  openingId: string | null;
  /** Channels whose dropdown the reader opened by hand. */
  expanded: ReadonlySet<string>;
  onToggle: (channelId: string) => void;
  onOpen?: (thread: ChannelThreadVM) => void;
  /** Hands the rail a thread's button, and takes it back with `null`. */
  register: (threadId: string, button: HTMLButtonElement | null) => void;
}
