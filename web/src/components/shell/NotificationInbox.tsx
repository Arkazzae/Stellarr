"use client";

import { useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { AnchoredCard } from "@/components/primitives/AnchoredCard";
import { formatAgo, formatFull } from "@/lib/format";
import type { InboxNotification, ServerInviteNotificationTarget } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** The source of a row written by the server when someone mentions the reader. */
const MENTION_PACKAGE_ID = "stellarr.mention";

export interface NotificationInboxProps {
  items: readonly InboxNotification[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasOlder: boolean;
  error: string | null;
  anchor: HTMLElement;
  onClose: () => void;
  onReload: () => void;
  onLoadOlder: () => void;
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
  onDelete: (notificationId: string) => void;
  /** The name of a channel the reader can see, or null when it is not known. */
  channelName: (channelId: string) => string | null;
  onOpenChannel: (channelId: string) => void;
  /** Accepts an invitation. Without it an invitation row has nothing to offer. */
  onJoinInvite?: (inviteCode: string) => Promise<void>;
}

interface NotificationRowProps {
  notification: InboxNotification;
  channelName: (channelId: string) => string | null;
  /** The invitation being accepted right now, if any. */
  joiningInvite: string | null;
  onMarkRead: (notificationId: string) => void;
  onDelete: (notificationId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onJoinInvite?: (inviteCode: string) => void;
}

function NotificationRow({
  notification,
  channelName,
  joiningInvite,
  onMarkRead,
  onDelete,
  onOpenChannel,
  onJoinInvite,
}: NotificationRowProps) {
  const { locale, t } = useLanguage();
  const { source, target } = notification;
  const unread = notification.readAt === undefined;
  const invite: ServerInviteNotificationTarget | null =
    target?.type === "server-invite" ? target : null;
  // A row opens a channel only when the reader can see it by name.
  const channelId = target?.type === "channel" ? target.channelId : null;
  const channel = channelId === null ? null : channelName(channelId);

  // Invitations and mentions are worded here, so that they follow the
  // reader's language; every other row arrives already written.
  let title = notification.title;
  let body = notification.body;
  if (invite !== null) {
    title = t("notifications.inviteTitle", { server: invite.serverName });
    body = t("notifications.inviteBody", {
      inviter: invite.invitedByName,
      server: invite.serverName,
    });
  } else if (source.packageId === MENTION_PACKAGE_ID) {
    title = t("notifications.mentionTitle", { author: source.moduleName });
  }

  return (
    <li
      className={unread ? "notification-item unread" : "notification-item"}
      data-tone={notification.tone}
    >
      {/* No marker column. Unread is carried by the text and by the tick being
          there to press; a dot in a gutter on every row would be one more
          badge for a state the row already shows. */}
      <div className="notification-item-main">
        <p className="notification-title">
          <strong>{title}</strong>
          {unread ? <span className="sr-only">{t("notifications.new")}</span> : null}
        </p>
        <p className="notification-body">{body}</p>
        <div className="notification-foot">
          <span className="notification-meta">
            <span className="notification-source">
              {source.packageName}
              {source.moduleName === source.packageName ? null : ` · ${source.moduleName}`}
            </span>
            <span aria-hidden="true">·</span>
            <time
              dateTime={notification.createdAt}
              title={formatFull(notification.createdAt, locale)}
            >
              {formatAgo(notification.createdAt, new Date(), locale)}
            </time>
          </span>
          {channelId === null || channel === null ? null : (
            <button
              type="button"
              className="notification-open"
              // The chip shows the channel's name; the accessible name has to
              // say what pressing it does.
              aria-label={t("notifications.openChannel", { channel })}
              title={t("notifications.openChannel", { channel })}
              onClick={() => {
                if (unread) onMarkRead(notification.id);
                onOpenChannel(channelId);
              }}
            >
              <Icon name="hash" size={12} />
              <span>{channel}</span>
            </button>
          )}
          {invite === null || onJoinInvite === undefined ? null : (
            <button
              type="button"
              className="notification-open primary"
              disabled={joiningInvite !== null}
              onClick={() => onJoinInvite(invite.inviteCode)}
            >
              {joiningInvite === invite.inviteCode
                ? t("notifications.inviteJoining")
                : t("notifications.inviteJoin")}
            </button>
          )}
        </div>
      </div>
      {/* Housekeeping, not content: a tick and a bin beside the row rather
          than two more links competing with what it says. */}
      <div className="notification-tools">
        {unread ? (
          <button
            type="button"
            className="notification-tool"
            aria-label={t("notifications.markRead")}
            title={t("notifications.markRead")}
            onClick={() => onMarkRead(notification.id)}
          >
            <Icon name="tick" size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="notification-tool danger"
          aria-label={t("notifications.delete", { title })}
          title={t("notifications.deleteShort")}
          onClick={() => onDelete(notification.id)}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </li>
  );
}

/** The signed-in user's private inbox, as a card hanging off the bell. */
export function NotificationInbox({
  items,
  unreadCount,
  loading,
  loadingMore,
  hasOlder,
  error,
  anchor,
  onClose,
  onReload,
  onLoadOlder,
  onMarkRead,
  onMarkAllRead,
  onDelete,
  channelName,
  onOpenChannel,
  onJoinInvite,
}: NotificationInboxProps) {
  const { t } = useLanguage();
  const [joiningInvite, setJoiningInvite] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const joinInvite =
    onJoinInvite === undefined
      ? undefined
      : (inviteCode: string) => {
          setInviteError(null);
          setJoiningInvite(inviteCode);
          onJoinInvite(inviteCode)
            .catch(() => setInviteError(t("notifications.inviteJoinFailed")))
            .finally(() => setJoiningInvite(null));
        };

  const message = error ?? inviteError;

  return (
    <AnchoredCard
      anchor={anchor}
      onClose={onClose}
      label={t("notifications.title")}
      className="notification-inbox"
    >
      <div className="notification-inbox-header">
        <div className="notification-inbox-heading">
          <h3>{t("notifications.title")}</h3>
          <p aria-live="polite">
            {unreadCount === 0
              ? t("notifications.allRead")
              : t("notifications.unreadCount", { count: unreadCount })}
          </p>
        </div>
        <div className="notification-inbox-head-actions">
          {unreadCount > 0 ? (
            <button
              type="button"
              className="notification-mark-all"
              aria-label={t("notifications.markAllRead")}
              title={t("notifications.markAllRead")}
              onClick={onMarkAllRead}
            >
              <span className="notification-mark-all-icon" aria-hidden="true">
                <Icon name="tick" size={16} />
              </span>
              <span className="notification-mark-all-label">
                {t("notifications.markAllRead")}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="notification-close"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      {message === null ? null : (
        <div className="notification-error" role="alert">
          <span>{message}</span>
          {/* Only a failed load can be retried here; a refused invitation is
              retried by pressing its button again. */}
          {error === null ? null : (
            <button type="button" onClick={onReload}>
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="notification-loading" aria-label={t("notifications.loading")}>
          {[0, 1, 2].map((placeholder) => (
            <div className="notification-skeleton" key={placeholder} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="notification-empty">
          <span className="notification-empty-icon" aria-hidden="true">
            <Icon name="bell" size={22} />
          </span>
          <strong>{t("notifications.emptyTitle")}</strong>
          <p>{t("notifications.emptyBody")}</p>
        </div>
      ) : (
        <ol className="notification-list">
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              channelName={channelName}
              joiningInvite={joiningInvite}
              onMarkRead={onMarkRead}
              onDelete={onDelete}
              onOpenChannel={onOpenChannel}
              onJoinInvite={joinInvite}
            />
          ))}
        </ol>
      )}

      {!loading && hasOlder ? (
        <button
          type="button"
          className="notification-load-older"
          disabled={loadingMore}
          onClick={onLoadOlder}
        >
          {loadingMore ? t("notifications.loadingOlder") : t("notifications.loadOlder")}
        </button>
      ) : null}
    </AnchoredCard>
  );
}
