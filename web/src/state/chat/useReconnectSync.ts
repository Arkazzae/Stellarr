import { useEffect } from "react";

import type { ChatPort, MessageSyncChange } from "@/ports";

import {
  PAGE_SIZE,
  type ChatDispatch,
  type PendingIds,
  type SyncCursors,
} from "./shared";
import { refreshThreads } from "./useThreadCatalogue";

interface CatchUp {
  chat: ChatPort;
  dispatch: ChatDispatch;
  pendingIds: PendingIds;
  syncCursors: SyncCursors;
  /** A message was deleted on the server; composer state pointing at it must go. */
  onRemoved: (messageId: string) => void;
}

function applyChanges(
  { chat, dispatch, onRemoved }: CatchUp,
  channelId: string,
  changes: readonly MessageSyncChange[],
): void {
  if (changes.length === 0) return;
  dispatch({ type: "synced", channelId, changes });
  for (const change of changes) {
    if (change.kind === "delete") onRemoved(change.messageId);
  }
  void refreshThreads(chat, dispatch, channelId).catch(() => undefined);
}

/**
 * Brings one channel up to date with the server's mutation journal.
 *
 * The first page is authoritative for its newest window, which also repairs a
 * deletion between bootstrap and the first socket connection. After that the
 * journal is drained page by page; a server that compacted it past our cursor
 * says `resetRequired`, and the window is read afresh.
 */
async function catchUp(
  env: CatchUp,
  channelId: string,
  isActive: () => boolean,
): Promise<void> {
  const { chat, dispatch, pendingIds, syncCursors } = env;
  try {
    await chat.focusChannel(channelId);
    let cursor = syncCursors.current[channelId];
    if (cursor === undefined) {
      const page = await chat.listMessages(channelId, { limit: PAGE_SIZE });
      if (!isActive()) return;
      dispatch({
        type: "first-page",
        channelId,
        page,
        pendingIds: new Set(pendingIds.current),
      });
      cursor = page.syncCursor;
      syncCursors.current[channelId] = cursor;
    }

    // Read the authoritative side list before draining the journal. A pin
    // changed while this request is in flight is then applied by the following
    // journal page instead of being overwritten by it.
    try {
      const messages = await chat.listPinned(channelId);
      if (!isActive()) return;
      dispatch({ type: "pins-set", channelId, messages });
      dispatch({ type: "pins-settled", channelId });
    } catch {
      // Keep the last known list; the journal still repairs changes.
    }

    while (isActive()) {
      const page = await chat.syncMessages(channelId, cursor);
      if (!isActive()) return;
      if (page.resetRequired) {
        const fresh = await chat.listMessages(channelId, { limit: PAGE_SIZE });
        if (!isActive()) return;
        dispatch({
          type: "reset",
          channelId,
          page: fresh,
          pendingIds: new Set(pendingIds.current),
        });
        void refreshThreads(chat, dispatch, channelId).catch(() => undefined);
        cursor = fresh.syncCursor;
        syncCursors.current[channelId] = cursor;
        try {
          const messages = await chat.listPinned(channelId);
          if (!isActive()) return;
          dispatch({ type: "pins-set", channelId, messages });
        } catch {
          // The next reconnect retries the side-list snapshot.
        }
        continue;
      }
      applyChanges(env, channelId, page.changes);
      cursor = page.nextCursor;
      syncCursors.current[channelId] = cursor;
      if (!page.hasMore) break;
    }
  } catch {
    // Retried from the last committed cursor after the next reconnect.
  }
}

/**
 * SignalR is transient. Every successful page carries a durable mutation
 * cursor, and each time the socket is up this drains that journal for every
 * text channel before push events are trusted again.
 */
export function useReconnectSync({
  connected,
  channelIds,
  chat,
  dispatch,
  pendingIds,
  syncCursors,
  onRemoved,
}: CatchUp & { connected: boolean; channelIds: readonly string[] }): void {
  useEffect(() => {
    if (!connected) return;
    let active = true;
    const env = { chat, dispatch, pendingIds, syncCursors, onRemoved };
    for (const channelId of channelIds) {
      void catchUp(env, channelId, () => active);
    }
    return () => {
      active = false;
    };
  }, [connected, channelIds, chat, dispatch, pendingIds, syncCursors, onRemoved]);
}
