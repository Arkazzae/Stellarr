"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import { IconButton } from "@/components/primitives/IconButton";
import type { MessageKey } from "@/i18n";
import type { Message } from "@/ports";
import { useLanguage } from "@/state/hooks";

import type {
  ChannelPanelTab,
  LinkItemVM,
  MediaItemVM,
} from "./channelPanelModel";
import type { IndexStatus } from "./IndexedTab";
import { LinksTab } from "./LinksTab";
import { MediaTab } from "./MediaTab";
import type { AttachmentCallbacks } from "./parts";
import { PinnedTab, type PinnedTabProps } from "./PinnedTab";
import { SearchPanel } from "./SearchPanel";

const TABS: readonly { value: ChannelPanelTab; label: MessageKey; icon: IconName }[] = [
  { value: "search", label: "room.tabSearch", icon: "search" },
  { value: "pinned", label: "room.tabPinned", icon: "pin" },
  { value: "media", label: "room.tabMedia", icon: "image" },
  { value: "links", label: "room.tabLinks", icon: "link" },
];

export interface ChannelPanelProps {
  /** Closed is a width of zero, not an unmount: the lists survive a peek. */
  open: boolean;
  tab: ChannelPanelTab;
  onTabChange(tab: ChannelPanelTab): void;
  onClose(): void;
  searchQuery: string;
  searchResults: readonly Message[];
  searchLoading: boolean;
  searchLoadingMore?: boolean;
  searchHasMore?: boolean;
  searchError?: string | null;
  onSearchQueryChange(query: string): void;
  onLoadMoreSearch?(): void;
  onRetrySearch?(): void;
  onOpenSearchResult?(message: Message): void;
  media: MediaItemVM[];
  links: LinkItemVM[];
  indexLoading?: boolean;
  indexLoadingMore?: boolean;
  indexHasMore?: boolean;
  indexError?: string | null;
  onLoadMoreIndex?(): void;
  onRetryIndex?(): void;
  /** The channel's pinned messages, newest pin first. */
  pinned: PinnedTabProps["pinned"];
  pinnedLoading?: boolean;
  pinError?: string | null;
  onOpenPin?: PinnedTabProps["onOpen"];
  onUnpin?: PinnedTabProps["onUnpin"];
  /** The same bag the transcript's tiles use, so a click lands in one viewer. */
  callbacks?: AttachmentCallbacks;
}

/** The tab an arrow, Home or End key moves to from `from`, or null for any other key. */
function tabAfterKey(key: string, from: number): number | null {
  const count = TABS.length;
  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from + count - 1) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The channel's own material, beside the conversation rather than over it.
 *
 * A grid track that animates from zero, the way every other panel in the shell
 * works: the transcript genuinely narrows, so nothing a reader was looking at
 * ends up underneath the panel. Below 1280 there is not enough width left to
 * take 320px from the room, and the CSS turns it into an overlay drawer inside
 * the room instead.
 */
export function ChannelPanel({
  open,
  tab,
  onTabChange,
  onClose,
  searchQuery,
  searchResults,
  searchLoading,
  searchLoadingMore = false,
  searchHasMore = false,
  searchError = null,
  onSearchQueryChange,
  onLoadMoreSearch,
  onRetrySearch,
  onOpenSearchResult,
  media,
  links,
  indexLoading = false,
  indexLoadingMore = false,
  indexHasMore = false,
  indexError = null,
  onLoadMoreIndex,
  onRetryIndex,
  pinned,
  pinnedLoading = false,
  pinError = null,
  onOpenPin,
  onUnpin,
  callbacks,
}: ChannelPanelProps) {
  const { t } = useLanguage();
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /*
   * Escape closes the panel before it reaches the drawers: listened for on
   * `document` with the event stopped, because `AppShell` listens one hop
   * further out on `window` and a single press must not also shut the rail
   * behind this.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A dialog is in front of the panel and owns the key.
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const index: IndexStatus = {
    loading: indexLoading,
    loadingMore: indexLoadingMore,
    hasMore: indexHasMore,
    error: indexError,
    onLoadMore: onLoadMoreIndex,
    onRetry: onRetryIndex,
  };

  const selected = TABS.findIndex((entry) => entry.value === tab);
  const tabStop = Math.max(selected, 0);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const to = tabAfterKey(event.key, from);
    const next = to === null ? undefined : TABS[to];
    if (to === null || next === undefined) return;
    event.preventDefault();
    tabRefs.current[to]?.focus();
    onTabChange(next.value);
  };

  return (
    // `inert` while shut: the panel keeps its lists and its scroll position, and
    // a control inside a zero-width box must not still be reachable.
    <aside
      className={open ? "channel-panel open" : "channel-panel"}
      aria-label={t("room.channelMaterials")}
      inert={!open}
    >
      <div className="cp-inner">
        <header className="cp-head">
          <div className="cp-tabs" role="tablist" aria-label={t("room.channelMaterials")}>
            {TABS.map((entry, at) => {
              const on = entry.value === tab;
              const label = t(entry.label);
              return (
                <button
                  key={entry.value}
                  type="button"
                  ref={(node) => {
                    tabRefs.current[at] = node;
                  }}
                  className={on ? "cp-tab on" : "cp-tab"}
                  role="tab"
                  title={label}
                  aria-label={label}
                  id={`${baseId}-${entry.value}`}
                  aria-selected={on}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={at === tabStop ? 0 : -1}
                  onClick={() => onTabChange(entry.value)}
                  onKeyDown={(event) => onTabKeyDown(event, at)}
                >
                  <Icon name={entry.icon} size={14} />
                  <span className="cp-tab-label" aria-hidden="true">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
          <IconButton
            icon="x"
            label={t("room.closePanel")}
            title={t("room.closePanel")}
            className="cp-close"
            onClick={onClose}
          />
        </header>

        <div
          className={tab === "search" ? "cp-body cp-body-search" : "cp-body"}
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-${tab}`}
          tabIndex={0}
        >
          {tab === "search" ? (
            <SearchPanel
              query={searchQuery}
              results={searchResults}
              loading={searchLoading}
              loadingMore={searchLoadingMore}
              hasMore={searchHasMore}
              error={searchError}
              onQueryChange={onSearchQueryChange}
              onLoadMore={onLoadMoreSearch}
              onRetry={onRetrySearch}
              onOpenResult={onOpenSearchResult}
            />
          ) : null}
          {tab === "pinned" ? (
            <PinnedTab
              pinned={pinned}
              loading={pinnedLoading}
              error={pinError}
              onOpen={onOpenPin}
              onUnpin={onUnpin}
            />
          ) : null}
          {tab === "media" ? (
            <MediaTab media={media} status={index} callbacks={callbacks} />
          ) : null}
          {tab === "links" ? <LinksTab links={links} status={index} /> : null}
        </div>
      </div>
    </aside>
  );
}
