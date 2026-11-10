export type NotificationTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

/** What produced a row. */
export interface NotificationSource {
  type: "sdk" | "system";
  packageId: string;
  packageName: string;
  moduleId: string;
  moduleName: string;
}

/** Opens a channel. */
export interface ChannelNotificationTarget {
  type: "channel";
  channelId: string;
}

/** Offers to join a server; the invite can come from a server the reader is not on. */
export interface ServerInviteNotificationTarget {
  type: "server-invite";
  inviteCode: string;
  serverId: string;
  serverName: string;
  invitedByName: string;
}

export type NotificationTarget =
  | ChannelNotificationTarget
  | ServerInviteNotificationTarget;

export interface InboxNotification {
  id: string;
  /** Increases with each row; pages are cut by it. */
  sequence: number;
  title: string;
  body: string;
  tone: NotificationTone;
  source: NotificationSource;
  /** Where activating the row leads, when it leads anywhere. */
  target?: NotificationTarget;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601; absent while unread. */
  readAt?: string;
}

export interface NotificationPage {
  items: InboxNotification[];
  /** Pass as `beforeSequence` for the next older page; null on the last one. */
  nextBeforeSequence: number | null;
  /** Unread rows in the inbox, not only on this page. */
  unreadCount: number;
  lastSequence: number;
}

/** `global` marks an invitation, which belongs to the account rather than to one server. */
export interface NotificationInboxChangedEvent {
  serverId: string;
  sequence?: number;
  global?: boolean;
}

/** The signed-in user's private inbox: active-server events plus global invitations. */
export interface NotificationPort {
  list(
    options?: { beforeSequence?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<NotificationPage>;
  markRead(notificationId: string, signal?: AbortSignal): Promise<InboxNotification>;
  /** Resolves to how many rows changed. */
  markAllRead(signal?: AbortSignal): Promise<number>;
  delete(notificationId: string, signal?: AbortSignal): Promise<void>;
  onChanged(listener: (event: NotificationInboxChangedEvent) => void): () => void;
}
