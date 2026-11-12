"use client";

import { useCallback, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { NotificationInbox } from "@/components/shell/NotificationInbox";
import {
  useDirectory,
  useLanguage,
  useNotifications,
  useSession,
  useUi,
} from "@/state/hooks";

const BADGE_LIMIT = 99;

/**
 * The bell in a header and the inbox it opens, anchored to the bell itself.
 * The inbox is mounted only while open, so a closed bell costs nothing.
 */
export function NotificationInboxButton() {
  const inbox = useNotifications();
  const directory = useDirectory();
  const ui = useUi();
  const session = useSession();
  const { t } = useLanguage();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  // Stable, because the inbox repositions and re-listens whenever it changes.
  const close = useCallback(() => setAnchor(null), []);
  const label =
    inbox.unreadCount > 0
      ? t("notifications.openUnread", { count: inbox.unreadCount })
      : t("notifications.open");

  const joinInvite = async (inviteCode: string) => {
    const server = await directory.joinInvite(inviteCode);
    directory.selectServer(server.id);
    ui.openServer();
    session.reload();
    close();
  };

  return (
    <>
      <button
        type="button"
        className="pill-btn notification-trigger"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          const bell = event.currentTarget;
          setAnchor((open) => (open === null ? bell : null));
        }}
      >
        <Icon name="bell" size={17} />
        {inbox.unreadCount > 0 ? (
          <span className="notification-badge" aria-hidden="true">
            {inbox.unreadCount > BADGE_LIMIT ? `${BADGE_LIMIT}+` : inbox.unreadCount}
          </span>
        ) : null}
      </button>
      {anchor === null ? null : (
        <NotificationInbox
          items={inbox.items}
          unreadCount={inbox.unreadCount}
          loading={inbox.loading}
          loadingMore={inbox.loadingMore}
          hasOlder={inbox.hasOlder}
          error={inbox.error}
          anchor={anchor}
          onClose={close}
          onReload={inbox.reload}
          onLoadOlder={() => void inbox.loadOlder()}
          onMarkRead={(id) => void inbox.markRead(id)}
          onMarkAllRead={() => void inbox.markAllRead()}
          onDelete={(id) => void inbox.remove(id)}
          channelName={(channelId) =>
            directory.textChannels.find((channel) => channel.id === channelId)?.name ?? null
          }
          onOpenChannel={(channelId) => {
            ui.selectTextChannel(channelId);
            close();
          }}
          onJoinInvite={joinInvite}
        />
      )}
    </>
  );
}
