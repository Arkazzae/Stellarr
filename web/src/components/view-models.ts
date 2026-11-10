/**
 * View models: the shapes presentational components take.
 *
 * Components in `src/components/**` are pure. They render these and raise
 * callbacks; containers in `src/state/**` build them from the ports.
 */

import type { Presence } from "@/ports";

export interface PersonVM {
  id: string;
  displayName: string;
  /** Two letters, precomputed so the avatar never re-derives them. */
  initials: string;
  presence: Presence;
  /** A picture, when they have one. The initials stay underneath it. */
  avatarUrl?: string;
  /** Only meaningful for someone in the current call. */
  speaking?: boolean;
  muted?: boolean;
  /** Overrides the id-derived colour when the server supplies one. */
  color?: string;
}

/**
 * Raised by any control that names a person: a roster row, an avatar in the
 * transcript, a friend. The mini profile hangs off the clicked element, so the
 * element travels with the id.
 */
export type OpenProfile = (userId: string, anchor: HTMLElement) => void;

/** Where someone stands in relation to you; decides what the card offers. */
export type ProfileRelation =
  | "self"
  | "friend"
  | "blocked"
  | "incoming"
  | "outgoing"
  | "none";

export interface ProfileRoleVM {
  id: string;
  name: string;
  /** Any CSS colour: roles are data, not theme tokens. */
  color: string;
}

/** A person as the mini profile shows them. */
export interface ProfileVM {
  person: PersonVM;
  /** Without the "@"; the card prints it under the display name. */
  username: string;
  relation: ProfileRelation;
  /** Their own artwork. Absent falls back to the id-derived hue. */
  bannerUrl?: string;
  /** A short, current line, separate from the longer bio. */
  customStatus?: string;
  /** What they wrote about themselves. Plain text; the card never parses it. */
  bio?: string;
  /** "ona/jej", printed beside the username exactly as they typed it. */
  pronouns?: string;
  /** The voice channel they are in, if any. */
  voiceChannelName?: string;
  roles: ProfileRoleVM[];
  /** "12 lipca 2026": the day they joined the server. */
  joinedAt?: string;
  /** "3 marca 2026": the day the friendship began. */
  friendsSince?: string;
  /** Answering or withdrawing a pending invitation needs its id. */
  requestId?: string;
}

export interface TextChannelVM {
  id: string;
  name: string;
  topic?: string;
  unread?: number;
  muted?: boolean;
  /** The rail section this channel is grouped under; absent if unsectioned. */
  sectionId?: string;
}

/** A collapsible rail group, in display order. */
export interface SectionVM {
  id: string;
  name: string;
}

/** A compact thread row nested below its text channel in the rail. */
export interface ChannelThreadVM {
  id: string;
  channelId: string;
  authorName: string;
  preview: string;
  replyCount: number;
}

export interface VoiceChannelVM {
  id: string;
  name: string;
  occupants: PersonVM[];
  /** The rail section this channel is grouped under; absent if unsectioned. */
  sectionId?: string;
}

/** A private thread as the rail lists it. */
export interface DmConversationVM {
  id: string;
  peer: PersonVM;
  /**
   * The second line, already composed ("Ada: uploaded", "You: will let you know", or the
   * invitation to start), so the rail never rebuilds a sentence from parts and
   * an empty thread is not a special case there.
   */
  preview: string;
  unread: number;
  /** Someone is occupying this conversation's private RTC room. */
  callActive?: boolean;
}

/** Which list the Friends view shows. "add" is a panel, not a filter. */
export type FriendsTab = "online" | "all" | "pending" | "blocked" | "add";

/** A person as the Friends view lists them. */
export interface FriendVM {
  person: PersonVM;
  /** Without the "@"; the row prints it after the display name. */
  username: string;
  /** Formatted date the friendship began. Absent for a blocked person. */
  since?: string;
}

export interface FriendRequestVM {
  id: string;
  person: PersonVM;
  username: string;
  /** Incoming is answered, outgoing is withdrawn; the row differs. */
  direction: "incoming" | "outgoing";
  /** "Sent 3 days ago". */
  when: string;
}

/** Which pane the room shows. Voice replaces the transcript, never splits it. */
export type RoomView = "text" | "voice";

export interface CallVM {
  channelId: string;
  channelName: string;
  /** A direct-conversation RTC room rather than a public server channel. */
  privateCall?: boolean;
  /** Epoch ms the call started, for the dock's elapsed counter. */
  startedAt: number;
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  cameraPending: boolean;
  sharing: boolean;
  /** Worst media RTT, or signalling RTT while no peer media exists. */
  latencyMs: number | null;
  /** Coarse quality derived from RTT and packet loss. */
  connectionQuality: "unknown" | "good" | "fair" | "poor";
  /** The dock's headline: live content wins over transport status. */
  headline:
    | "requesting-mic"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "degraded"
    | "failed"
    | "screen";
}

export interface ScreenShareVM {
  ownerId: string;
  ownerName: string;
  hasAudio: boolean;
  /** Null while the viewer has not opted in yet. */
  stream: MediaStream | null;
  /** A still to show before the viewer opts in, when there is no stream. */
  posterUrl?: string;
  watching: boolean;
}
