import { useEffect, useRef } from "react";

import type { ChatPort } from "@/ports";

import type { ChatDispatch } from "./shared";

/** Reads one channel's threads into the store. */
export function refreshThreads(
  chat: ChatPort,
  dispatch: ChatDispatch,
  channelId: string,
): Promise<void> {
  return chat.listThreads(channelId).then((threads) => {
    dispatch({ type: "threads-set", channelId, threads });
  });
}

/**
 * Thread dropdowns must describe the whole channel, not the last transcript
 * page, so each channel is read once. Live replies keep it current after that.
 */
export function useThreadCatalogue(
  chat: ChatPort,
  channelIds: readonly string[],
  loaded: Readonly<Record<string, boolean>>,
  dispatch: ChatDispatch,
): void {
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    for (const channelId of channelIds) {
      if (loaded[channelId] === true || inFlight.current.has(channelId)) continue;
      inFlight.current.add(channelId);
      void refreshThreads(chat, dispatch, channelId)
        .catch(() => dispatch({ type: "threads-set", channelId, threads: [] }))
        .finally(() => {
          inFlight.current.delete(channelId);
          dispatch({ type: "threads-settled", channelId });
        });
    }
  }, [chat, channelIds, loaded, dispatch]);
}
