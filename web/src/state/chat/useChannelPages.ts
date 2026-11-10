import { useCallback, useEffect, useRef } from "react";

import type { ChatPort } from "@/ports";

import type { ChatData } from "./chatStore";
import {
  PAGE_SIZE,
  type ChatDispatch,
  type PendingIds,
  type SyncCursors,
} from "./shared";

interface ChannelPagesOptions {
  chat: ChatPort;
  /** The channel on screen; the only one whose history is read on demand. */
  channelId: string | null;
  data: ChatData;
  dispatch: ChatDispatch;
  pendingIds: PendingIds;
  syncCursors: SyncCursors;
}

/**
 * Reads the open channel from the server: its newest page and pinned list
 * once, and older pages whenever the reader scrolls to the top.
 *
 * @returns `loadOlder`, a no-op while a page is in flight or none remains.
 */
export function useChannelPages({
  chat,
  channelId,
  data,
  dispatch,
  pendingIds,
  syncCursors,
}: ChannelPagesOptions): { loadOlder: () => void } {
  const initialInFlight = useRef(new Set<string>());
  const olderInFlight = useRef(new Set<string>());
  const pinsInFlight = useRef(new Set<string>());
  const loaded = data.loaded;
  const pinsLoaded = data.pinsLoaded;
  const nextCursor = channelId === null ? undefined : data.nextCursor[channelId];

  useEffect(() => {
    if (
      channelId === null ||
      loaded[channelId] === true ||
      initialInFlight.current.has(channelId)
    ) {
      return;
    }
    initialInFlight.current.add(channelId);
    void chat
      .listMessages(channelId, { limit: PAGE_SIZE })
      .then((page) => {
        syncCursors.current[channelId] = page.syncCursor;
        dispatch({
          type: "first-page",
          channelId,
          page,
          pendingIds: new Set(pendingIds.current),
        });
      })
      // The channel simply stays as it is; the transcript is not the place to
      // report a failed page load.
      .catch(() => dispatch({ type: "first-page-failed", channelId }))
      .finally(() => {
        initialInFlight.current.delete(channelId);
      });
  }, [chat, channelId, loaded, dispatch, pendingIds, syncCursors]);

  /*
   * The pinned list, once per channel opened.
   *
   * Not refreshed after that: every change to it arrives as an update and is
   * applied by the store, so a second fetch would only be a chance to disagree
   * with the push. A server that predates pinning answers with an empty list.
   */
  useEffect(() => {
    if (
      channelId === null ||
      pinsLoaded[channelId] === true ||
      pinsInFlight.current.has(channelId)
    ) {
      return;
    }
    pinsInFlight.current.add(channelId);
    void chat
      .listPinned(channelId)
      .then((messages) => dispatch({ type: "pins-set", channelId, messages }))
      // The pins are a side list; a failed read of one is not worth an alert
      // over the conversation, and the panel says the channel has none.
      .catch(() => dispatch({ type: "pins-set", channelId, messages: [] }))
      .finally(() => {
        pinsInFlight.current.delete(channelId);
        dispatch({ type: "pins-settled", channelId });
      });
  }, [chat, channelId, pinsLoaded, dispatch]);

  const loadOlder = useCallback(() => {
    if (
      channelId === null ||
      typeof nextCursor !== "string" ||
      olderInFlight.current.has(channelId)
    ) {
      return;
    }
    olderInFlight.current.add(channelId);
    dispatch({ type: "older-loading", channelId, loading: true });
    void chat
      .listMessages(channelId, { cursor: nextCursor, limit: PAGE_SIZE })
      .then((page) => dispatch({ type: "older-page", channelId, page }))
      // The cursor is kept, so another trip to the top retries this page.
      .catch(() => undefined)
      .finally(() => {
        olderInFlight.current.delete(channelId);
        dispatch({ type: "older-loading", channelId, loading: false });
      });
  }, [chat, channelId, nextCursor, dispatch]);

  return { loadOlder };
}
