"use client";

import type { ReactNode } from "react";

import { useLanguage } from "@/state/hooks";

import { IndexError, LoadOlderButton } from "./IndexNotices";

/** Where the channel index stands: the pages that fed a tab, and what went wrong. */
export interface IndexStatus {
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onLoadMore?(): void;
  onRetry?(): void;
}

/**
 * The frame of a tab that lists what the channel index returned.
 *
 * An empty list means "nothing yet" only while the index is quiet: loading says
 * so, and a failure is shown as the failure rather than as an empty channel.
 */
export function IndexedTab({
  status,
  empty,
  emptyText,
  children,
}: {
  status: IndexStatus;
  /** Nothing to list yet; `children` is rendered only when this is false. */
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const { loading, loadingMore, hasMore, error } = status;

  return (
    <>
      {!empty ? (
        children
      ) : loading ? (
        <p className="cp-empty">{t("common.loading")}</p>
      ) : error === null ? (
        <p className="cp-empty">{emptyText}</p>
      ) : null}
      {error === null ? null : <IndexError message={error} onRetry={status.onRetry} />}
      {hasMore || loadingMore ? (
        <LoadOlderButton loading={loadingMore} onLoad={status.onLoadMore} />
      ) : null}
    </>
  );
}
