import type {
  Attachment,
  Message,
  User,
  UserId,
  VoiceOccupant,
} from "@/lib/api/types";

import type { Unsubscribe } from "./chat";

/** Friends and direct messages, backed by the social API and SignalR. */

/** A conversation between exactly two people; groups are not modelled. */
export type DmId = string;

/** Where a pending request came from; the two are answered differently. */
export type RequestDirection = "incoming" | "outgoing";

export interface Friend {
  user: User;
  /** ISO 8601. The "Wszyscy" list falls back to the display name for order. */
  since: string;
}

export interface FriendRequest {
  id: string;
  user: User;
  direction: RequestDirection;
  /** ISO 8601, shown as "sent 3 days ago". */
  sentAt: string;
}

export interface DmConversation {
  id: DmId;
  /** The other person; self is never in here. */
  peer: User;
  /** Newest message, for the rail's second line. Absent on an empty thread. */
  lastMessage?: Message;
  unread: number;
  /** ISO 8601 of `lastMessage`, or of the moment the thread was opened. */
  updatedAt: string;
  /** Ephemeral RTC occupancy; absent or empty means there is no call to join. */
  callParticipants?: readonly VoiceOccupant[];
  /** Stable for one occupancy lifetime, through mute and speaking updates. */
  callId?: string;
}

/** What "Dodaj znajomego" can answer; each maps to one sentence in the UI. */
export type AddFriendResult =
  | "sent"
  | "unknown-user"
  | "already-friends"
  | "already-sent"
  | "self"
  | "blocked";

export interface FriendsPort {
  /** Loads the persisted snapshot once the session has bootstrapped. */
  load(): Promise<void>;
  listFriends(): Friend[];
  listRequests(): FriendRequest[];
  listBlocked(): User[];
  listConversations(): DmConversation[];

  /** Oldest first, the order a transcript reads in. */
  listDmMessages(id: DmId): Message[];
  hasOlderDmMessages(id: DmId): boolean;
  isLoadingOlderDmMessages(id: DmId): boolean;
  loadOlderDmMessages(id: DmId): Promise<void>;

  /** Opens (or finds) the conversation with `userId` and returns its id. */
  openConversation(userId: UserId): Promise<DmId>;
  sendDm(
    id: DmId,
    input: { content: string; attachmentIds: string[]; clientMessageId: string },
  ): Promise<Message>;
  uploadAttachment(file: File): Promise<Attachment>;
  markRead(id: DmId): void;
  /** Rejects the current private RTC attempt and releases its caller. */
  declineCall(id: DmId): Promise<void>;

  /** `username` as typed, with or without a leading `@`. */
  addFriend(username: string): Promise<AddFriendResult>;
  acceptRequest(id: string): Promise<void>;
  declineRequest(id: string): Promise<void>;
  /** Withdraws an outgoing request. */
  cancelRequest(id: string): Promise<void>;
  removeFriend(userId: UserId): Promise<void>;
  block(userId: UserId): Promise<void>;
  unblock(userId: UserId): Promise<void>;

  /** Fires after every mutation above and on incoming realtime events. */
  onChanged(handler: () => void): Unsubscribe;

  /** Releases the realtime listeners an adapter owns. */
  dispose?(): void;
}
