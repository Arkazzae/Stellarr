"use client";

import { useCallback, useEffect, useState } from "react";

import { describeError } from "@/lib/api/errors";
import type { Message, MessageIndexKind } from "@/ports";
import { useLanguage, usePorts } from "@/state/hooks";

export interface IndexedPagesRequest {
  kind: MessageIndexKind;
  query?: string;
  limit: number;
  /** How long to wait before the first page is fetched, so typing is not a fetch per key. */
  delayMs: number;
}

interface Pages {
  /** Which channel and request these pages answer; a stale one is never shown. */
  scope: string;
  messages: Message[];
  cursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  failure: { cause: unknown } | null;
}

const NONE: Message[] = [];
const BLANK: Pages = {
  scope: "",
  messages: NONE,
  cursor: null,
  loading: false,
  loadingMore: false,
  failure: null,
};

function appended(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const seen = new Set(current.map((message) => message.id));
  return [...current, ...incoming.filter((message) => !seen.has(message.id))];
}

/**
 * One channel's server-side message index, read a page at a time.
 *
 * Pages that belong to an earlier channel or request are hidden the moment the
 * request changes, before the new first page arrives, so the panel never shows
 * one query's results under another's heading. A null request reads nothing.
 */
export function useIndexedPages(
  channelId: string | null,
  request: IndexedPagesRequest | null,
) {
  const ports = usePorts();
  const { t } = useLanguage();
  const [pages, setPages] = useState(BLANK);
  const [attempt, setAttempt] = useState(0);

  const kind = request?.kind;
  const query = request?.query;
  const limit = request?.limit ?? 0;
  const delayMs = request?.delayMs ?? 0;
  const scope = `${channelId ?? ""}:${query ?? kind ?? ""}`;
  const current = request !== null && pages.scope === scope;

  useEffect(() => {
    if (channelId === null || kind === undefined) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setPages({ ...BLANK, scope, loading: true });
      ports.chat
        .listIndexed(channelId, { kind, ...(query === undefined ? {} : { query }), limit })
        .then((page) => {
          if (live) {
            setPages((state) => ({
              ...state,
              messages: page.messages,
              cursor: page.nextCursor,
              loading: false,
            }));
          }
        })
        .catch((cause: unknown) => {
          if (live) setPages((state) => ({ ...state, failure: { cause }, loading: false }));
        });
    }, delayMs);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [channelId, kind, query, limit, delayMs, scope, attempt, ports]);

  const loadMore = useCallback(() => {
    if (
      channelId === null ||
      kind === undefined ||
      !current ||
      pages.cursor === null ||
      pages.loadingMore
    ) {
      return;
    }
    setPages((state) => ({ ...state, loadingMore: true, failure: null }));
    ports.chat
      .listIndexed(channelId, {
        kind,
        ...(query === undefined ? {} : { query }),
        cursor: pages.cursor,
        limit,
      })
      .then((page) => {
        setPages((state) =>
          state.scope === scope
            ? {
                ...state,
                messages: appended(state.messages, page.messages),
                cursor: page.nextCursor,
                loadingMore: false,
              }
            : state,
        );
      })
      .catch((cause: unknown) => {
        setPages((state) =>
          state.scope === scope
            ? { ...state, failure: { cause }, loadingMore: false }
            : state,
        );
      });
  }, [channelId, kind, query, limit, scope, current, pages.cursor, pages.loadingMore, ports]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return {
    messages: current ? pages.messages : NONE,
    loading: request !== null && (!current || pages.loading),
    loadingMore: current && pages.loadingMore,
    hasMore: current && pages.cursor !== null,
    error:
      current && pages.failure !== null
        ? describeError(pages.failure.cause, t("room.indexLoadFailed"), t)
        : null,
    loadMore,
    retry,
  };
}
