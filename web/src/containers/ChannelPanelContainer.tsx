"use client";

import { useCallback, useMemo, useState } from "react";

import { ChannelPanel } from "@/components/room/ChannelPanel";
import {
  collectIndexedPanelItems,
  collectPanelItems,
  type LinkItemVM,
  type MediaItemVM,
} from "@/components/room/channelPanelModel";
import type { AttachmentCallbacks } from "@/components/room/parts";
import type { Message } from "@/ports";
import { useChat, useDirectory, useUi } from "@/state/hooks";

import { useIndexedPages } from "./useIndexedPages";

const MIN_QUERY_LENGTH = 2;
const SEARCH_PAGE = 50;
const SEARCH_DELAY_MS = 250;
const MATERIAL_PAGE = 60;

const newestFirst = <Item extends { timestamp: string }>(a: Item, b: Item) =>
  new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

/** What the index and the loaded transcript both know, once per item, newest first. */
function mergeMedia(
  indexed: readonly MediaItemVM[],
  loaded: readonly MediaItemVM[],
): MediaItemVM[] {
  const byId = new Map<string, MediaItemVM>();
  for (const item of [...indexed, ...loaded]) byId.set(item.id, item);
  return [...byId.values()].sort(newestFirst);
}

/** The same link posted twice is listed once, at its newest. */
function mergeLinks(
  indexed: readonly LinkItemVM[],
  loaded: readonly LinkItemVM[],
): LinkItemVM[] {
  const seen = new Set<string>();
  return [...indexed, ...loaded].sort(newestFirst).filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

interface ChannelPanelContainerProps {
  open: boolean;
  /** The bag the transcript's tiles use, so a click lands in one viewer. */
  callbacks: AttachmentCallbacks;
  /** Scrolls the transcript to a message; only the transcript can. */
  onJump: (messageId: string) => void;
}

/**
 * The channel's search, media, links and pins. It stays mounted while closed,
 * so a query and its results survive a peek at another tab.
 */
export function ChannelPanelContainer({
  open,
  callbacks,
  onJump,
}: ChannelPanelContainerProps) {
  const chat = useChat();
  const ui = useUi();
  const { canManageMessages } = useDirectory();
  const [searchQuery, setSearchQuery] = useState("");

  const query = searchQuery.trim();
  const materialKind =
    ui.channelPanel === "media" || ui.channelPanel === "links" ? ui.channelPanel : null;

  const search = useIndexedPages(
    chat.channelId,
    ui.channelPanel === "search" && chat.channelId !== null && query.length >= MIN_QUERY_LENGTH
      ? { kind: "all", query, limit: SEARCH_PAGE, delayMs: SEARCH_DELAY_MS }
      : null,
  );
  const materials = useIndexedPages(
    chat.channelId,
    materialKind === null ? null : { kind: materialKind, limit: MATERIAL_PAGE, delayMs: 0 },
  );

  // Walked out of the loaded transcript, which is long: rebuild it only when
  // the transcript changes, not on every keystroke in the composer.
  const loaded = useMemo(() => collectPanelItems(chat.sections), [chat.sections]);
  const indexed = useMemo(
    () => collectIndexedPanelItems(materials.messages),
    [materials.messages],
  );
  const media = useMemo(
    () => mergeMedia(indexed.media, loaded.media),
    [indexed.media, loaded.media],
  );
  const links = useMemo(
    () => mergeLinks(indexed.links, loaded.links),
    [indexed.links, loaded.links],
  );

  const { revealMessage } = chat;
  const { closeDrawers } = ui;
  const openSearchResult = useCallback(
    (message: Message) => {
      revealMessage(message);
      // Below the desktop layout the panel is a drawer over the transcript;
      // beside it, on desktop, the results are worth keeping in view.
      closeDrawers();
      // Two frames: the revealed message has to be rendered before it can be
      // scrolled to.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => onJump(message.id));
      });
    },
    [revealMessage, closeDrawers, onJump],
  );

  return (
    <ChannelPanel
      open={open}
      tab={ui.channelPanelTab}
      onTabChange={ui.showChannelPanelTab}
      onClose={ui.closeChannelPanel}
      searchQuery={searchQuery}
      searchResults={search.messages}
      searchLoading={search.loading}
      searchLoadingMore={search.loadingMore}
      searchHasMore={search.hasMore}
      searchError={search.error}
      onSearchQueryChange={setSearchQuery}
      onLoadMoreSearch={search.loadMore}
      onRetrySearch={search.retry}
      onOpenSearchResult={openSearchResult}
      media={media}
      links={links}
      indexLoading={materials.loading}
      indexLoadingMore={materials.loadingMore}
      indexHasMore={materials.hasMore}
      indexError={materials.error}
      onLoadMoreIndex={materials.loadMore}
      onRetryIndex={materials.retry}
      pinned={chat.pinned}
      pinnedLoading={chat.pinnedLoading}
      pinError={chat.pinError}
      onOpenPin={onJump}
      // Only for those who may moderate: the toolbar and the context menu
      // follow the same rule, and the server enforces it for all three.
      onUnpin={canManageMessages ? (id) => chat.runAction(id, "pin") : undefined}
      callbacks={callbacks}
    />
  );
}
