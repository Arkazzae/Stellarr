"use client";

import { Icon } from "@stellarr/ui/icons";
import { formatFull } from "@/lib/format";
import type { Message } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { IndexError, LoadOlderButton } from "./IndexNotices";

/** The server index needs at least this much to look for. */
const MIN_QUERY_LENGTH = 2;

export interface SearchPanelProps {
  query: string;
  results: readonly Message[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  error?: string | null;
  onQueryChange(query: string): void;
  onLoadMore?(): void;
  onRetry?(): void;
  onOpenResult?(message: Message): void;
}

/** What a result carries besides its text: the names of its files and links. */
function materialsOf(message: Message): string {
  return [
    ...message.attachments.map((attachment) => attachment.name),
    ...message.embeds.map((embed) => embed.title || embed.url),
  ].join(" · ");
}

/** Full-history search over the channel's server-side index. */
export function SearchPanel({
  query,
  results,
  loading,
  loadingMore = false,
  hasMore = false,
  error = null,
  onQueryChange,
  onLoadMore,
  onRetry,
  onOpenResult,
}: SearchPanelProps) {
  const { locale, t } = useLanguage();
  const searchable = query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="cp-search">
      <div className="cp-search-field">
        <Icon name="search" size={16} />
        <input
          autoFocus
          type="search"
          value={query}
          placeholder={t("room.searchPlaceholder")}
          aria-label={t("common.search")}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="cp-search-results" aria-live="polite">
        {loading ? <p>{t("common.loading")}</p> : null}
        {!loading && !searchable ? <p>{t("room.searchIndexHint")}</p> : null}
        {!loading && searchable && error === null && results.length === 0 ? (
          <p>{t("room.searchEmpty")}</p>
        ) : null}
        {error === null ? null : <IndexError message={error} onRetry={onRetry} />}
        {results.map((message) => {
          const materials = materialsOf(message);
          return (
            <button
              key={message.id}
              type="button"
              className="cp-search-result"
              onClick={() => onOpenResult?.(message)}
            >
              <span className="cp-search-result-head">
                <b>{message.author.displayName}</b>
                <time dateTime={message.createdAt}>
                  {formatFull(message.createdAt, locale)}
                </time>
              </span>
              <span className="cp-search-result-text">
                {message.content || t("room.searchAttachment")}
              </span>
              {materials === "" ? null : (
                <span className="cp-search-result-materials">{materials}</span>
              )}
            </button>
          );
        })}
        {hasMore || loadingMore ? (
          <LoadOlderButton loading={loadingMore} onLoad={onLoadMore} />
        ) : null}
      </div>
    </div>
  );
}
