"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { describeError } from "@/lib/api/errors";
import type { InboxNotification } from "@/ports";

import { useDirectoryContext } from "./DirectoryProvider";
import { useLanguage } from "./LanguageProvider";
import { usePorts } from "./PortsProvider";

const PAGE_SIZE = 30;

export interface NotificationValue {
  items: InboxNotification[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasOlder: boolean;
  error: string | null;
  reload: () => void;
  loadOlder: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (notificationId: string) => Promise<void>;
}

/** One server's inbox. The id says whose it is, so a late answer can be recognised as stale. */
interface Inbox {
  serverId: string;
  items: InboxNotification[];
  nextBeforeSequence: number | null;
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const NotificationContext = createContext<NotificationValue | null>(null);

const emptyInbox = (serverId: string): Inbox => ({
  serverId,
  items: [],
  nextBeforeSequence: null,
  unreadCount: 0,
  loading: true,
  loadingMore: false,
  error: null,
});

const isUnread = (item: InboxNotification | undefined): boolean =>
  item !== undefined && item.readAt === undefined;

/**
 * Applies a change to the inbox of `serverId` and leaves any other inbox alone.
 * The answer to a request can arrive after the person has moved to another
 * server, and it must not be written over that server's list.
 */
function ifInboxOf(serverId: string, change: (inbox: Inbox) => Inbox) {
  return (inbox: Inbox): Inbox => (inbox.serverId === serverId ? change(inbox) : inbox);
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { notifications } = usePorts();
  const { server } = useDirectoryContext();
  const { t } = useLanguage();
  const [reloadRevision, setReloadRevision] = useState(0);
  const [inbox, setInbox] = useState<Inbox>(() => emptyInbox(server.id));
  const serverId = server.id;

  const failureText = useCallback(
    (cause: unknown) => describeError(cause, t("notifications.loadFailed"), t),
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    // A populated inbox stays steady while realtime refreshes it, and only an
    // empty one (first load, or a retry) shows the skeleton.
    setInbox((value) =>
      value.serverId === serverId
        ? { ...value, loading: value.items.length === 0, loadingMore: false, error: null }
        : emptyInbox(serverId),
    );

    notifications
      .list({ limit: PAGE_SIZE }, controller.signal)
      .then((page) => {
        if (!current) return;
        setInbox({
          serverId,
          items: page.items,
          nextBeforeSequence: page.nextBeforeSequence,
          unreadCount: page.unreadCount,
          loading: false,
          loadingMore: false,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setInbox((value) => ({ ...value, loading: false, error: failureText(cause) }));
      });

    const unsubscribe = notifications.onChanged((event) => {
      if (event.global === true || event.serverId === serverId) {
        setReloadRevision((revision) => revision + 1);
      }
    });
    return () => {
      current = false;
      controller.abort();
      unsubscribe();
    };
  }, [failureText, notifications, reloadRevision, serverId]);

  const reload = useCallback(() => setReloadRevision((revision) => revision + 1), []);

  const loadOlder = useCallback(async () => {
    const { nextBeforeSequence, loading, loadingMore } = inbox;
    if (nextBeforeSequence === null || loading || loadingMore) return;
    const requestedFor = inbox.serverId;
    setInbox(ifInboxOf(requestedFor, (value) => ({ ...value, loadingMore: true, error: null })));
    try {
      const page = await notifications.list({
        beforeSequence: nextBeforeSequence,
        limit: PAGE_SIZE,
      });
      setInbox(
        ifInboxOf(requestedFor, (value) => {
          const known = new Set(value.items.map((item) => item.id));
          return {
            ...value,
            items: [...value.items, ...page.items.filter((item) => !known.has(item.id))],
            nextBeforeSequence: page.nextBeforeSequence,
            unreadCount: page.unreadCount,
            loadingMore: false,
          };
        }),
      );
    } catch (cause) {
      setInbox(
        ifInboxOf(requestedFor, (value) => ({
          ...value,
          loadingMore: false,
          error: failureText(cause),
        })),
      );
    }
  }, [failureText, inbox, notifications]);

  const markRead = useCallback(
    async (notificationId: string) => {
      try {
        const updated = await notifications.markRead(notificationId);
        setInbox(
          ifInboxOf(serverId, (value) => ({
            ...value,
            items: value.items.map((item) => (item.id === notificationId ? updated : item)),
            unreadCount: Math.max(
              0,
              value.unreadCount -
                (isUnread(value.items.find((item) => item.id === notificationId)) ? 1 : 0),
            ),
            error: null,
          })),
        );
      } catch (cause) {
        setInbox(ifInboxOf(serverId, (value) => ({ ...value, error: failureText(cause) })));
      }
    },
    [failureText, notifications, serverId],
  );

  const markAllRead = useCallback(async () => {
    try {
      await notifications.markAllRead();
      const readAt = new Date().toISOString();
      setInbox(
        ifInboxOf(serverId, (value) => ({
          ...value,
          items: value.items.map((item) => (isUnread(item) ? { ...item, readAt } : item)),
          unreadCount: 0,
          error: null,
        })),
      );
    } catch (cause) {
      setInbox(ifInboxOf(serverId, (value) => ({ ...value, error: failureText(cause) })));
    }
  }, [failureText, notifications, serverId]);

  const remove = useCallback(
    async (notificationId: string) => {
      try {
        await notifications.delete(notificationId);
        setInbox(
          ifInboxOf(serverId, (value) => ({
            ...value,
            items: value.items.filter((item) => item.id !== notificationId),
            unreadCount: Math.max(
              0,
              value.unreadCount -
                (isUnread(value.items.find((item) => item.id === notificationId)) ? 1 : 0),
            ),
            error: null,
          })),
        );
      } catch (cause) {
        setInbox(ifInboxOf(serverId, (value) => ({ ...value, error: failureText(cause) })));
      }
    },
    [failureText, notifications, serverId],
  );

  const value = useMemo<NotificationValue>(
    () => ({
      items: inbox.items,
      unreadCount: inbox.unreadCount,
      loading: inbox.loading,
      loadingMore: inbox.loadingMore,
      hasOlder: inbox.nextBeforeSequence !== null,
      error: inbox.error,
      reload,
      loadOlder,
      markRead,
      markAllRead,
      remove,
    }),
    [inbox, reload, loadOlder, markRead, markAllRead, remove],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationContext(): NotificationValue {
  const value = useContext(NotificationContext);
  if (value === null) {
    throw new Error("useNotificationContext must be used inside <NotificationProvider>");
  }
  return value;
}
