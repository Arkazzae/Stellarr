import { useCallback, useEffect, useState } from "react";

import { cockpitApi, type CockpitLogEntry, type CockpitLogFilters, type CockpitLogs } from "@/lib/api";

export type LogSummary = Pick<CockpitLogs, "levels" | "sources" | "capacity">;

interface Feed {
  /** The request this state answers; anything else means a new read is under way. */
  key: string;
  entries: CockpitLogEntry[];
  nextBefore: number | null;
  summary: LogSummary | null;
  error: string | null;
}

export interface LogFeed {
  entries: CockpitLogEntry[];
  summary: LogSummary | null;
  hasMore: boolean;
  /** A new first page is being read; the previous lines stay on screen meanwhile. */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  reload: () => void;
}

const summaryOf = ({ levels, sources, capacity }: CockpitLogs): LogSummary => ({ levels, sources, capacity });

/**
 * The log lines that match `filters`, newest first. A change of filters, or a
 * reload, reads the first page again; `loadMore` appends the next older page.
 */
export function useLogFeed(filters: CockpitLogFilters, failureMessage: string): LogFeed {
  const [generation, setGeneration] = useState(0);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${JSON.stringify(filters)}#${generation}`;

  useEffect(() => {
    const controller = new AbortController();
    cockpitApi.logs(filters, null, controller.signal).then(
      (page) =>
        setFeed({ key, entries: page.entries, nextBefore: page.nextBefore, summary: summaryOf(page), error: null }),
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        const error = cause instanceof Error ? cause.message : failureMessage;
        setFeed((previous) => ({
          key,
          entries: previous?.entries ?? [],
          nextBefore: null,
          summary: previous?.summary ?? null,
          error,
        }));
      },
    );
    return () => controller.abort();
  }, [filters, key, failureMessage]);

  const current = feed?.key === key ? feed : null;

  const loadMore = useCallback(async () => {
    if (!current || current.nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await cockpitApi.logs(filters, current.nextBefore);
      setFeed((previous) =>
        previous?.key === key
          ? {
              ...previous,
              entries: [...previous.entries, ...page.entries],
              nextBefore: page.nextBefore,
              summary: summaryOf(page),
              error: null,
            }
          : previous,
      );
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : failureMessage;
      setFeed((previous) => (previous?.key === key ? { ...previous, error } : previous));
    } finally {
      setLoadingMore(false);
    }
  }, [current, failureMessage, filters, key, loadingMore]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  return {
    entries: feed?.entries ?? [],
    summary: feed?.summary ?? null,
    hasMore: current?.nextBefore != null,
    loading: current === null,
    loadingMore,
    error: feed?.error ?? null,
    loadMore,
    reload,
  };
}
