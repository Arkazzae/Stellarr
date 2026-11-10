import type { ChannelId, Presence, User, UserId, VoiceOccupant } from "@/lib/api/types";

import type { Unsubscribe } from "./chat";

/**
 * Who is here, and where.
 *
 * Voice occupancy is presence, not media: the rail shows who sits in a voice
 * channel whether or not this client has joined it, so it cannot come from the
 * RTC layer.
 */
export interface PresencePort {
  listMembers(): User[];
  presenceOf(userId: UserId): Presence;
  /** The server echoes the accepted value through `onPresenceChanged`. */
  setPresence(presence: Presence): Promise<void>;
  onPresenceChanged(
    handler: (userId: UserId, presence: Presence) => void,
  ): Unsubscribe;

  occupantsOf(channelId: ChannelId): VoiceOccupant[];
  onOccupantsChanged(
    handler: (channelId: ChannelId, occupants: VoiceOccupant[]) => void,
  ): Unsubscribe;
}

/** Control-plane health, shown as a strip rather than a modal. */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionPort {
  getStatus(): ConnectionStatus;
  subscribe(listener: () => void): Unsubscribe;
}
