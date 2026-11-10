"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import type { FriendsTab } from "@/components/view-models";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/LanguageProvider";

type ListTab = Exclude<FriendsTab, "add">;

export const LIST_TABS: readonly ListTab[] = ["online", "all", "pending", "blocked"];

export const TAB_LABEL: Record<ListTab, MessageKey> = {
  online: "friends.tabOnline",
  all: "friends.tabAll",
  pending: "friends.tabPending",
  blocked: "friends.tabBlocked",
};

export function tabId(idBase: string, tab: ListTab): string {
  return `${idBase}-${tab}`;
}

export function panelId(idBase: string): string {
  return `${idBase}-panel`;
}

/** Where an arrow, Home or End key takes the focus; null for any other key. */
function destination(key: string, from: number, count: number): number | null {
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

export interface FriendsTabListProps {
  tab: FriendsTab;
  onTabChange: (tab: FriendsTab) => void;
  /** Request count that earns the Pending tab a badge. */
  incoming: number;
  /** Prefix of the ids the tabs and the panel they control share. */
  idBase: string;
}

/**
 * The four lists as a real tablist: arrows move and select, `aria-selected`
 * carries the state, and only one tab is in the tab order. While the add panel
 * is open none of them is selected, so the first one holds the tab stop.
 */
export function FriendsTabList({ tab, onTabChange, incoming, idBase }: FriendsTabListProps) {
  const { t } = useLanguage();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = LIST_TABS.findIndex((candidate) => candidate === tab);
  const tabStop = Math.max(selected, 0);

  // On a phone the strip scrolls sideways in the header; keep the tab that
  // holds the focus in view when the viewport changes or an arrow key moves
  // farther than the row can show.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      buttons.current[tabStop]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, tabStop]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const to = destination(event.key, from, LIST_TABS.length);
    const next = to === null ? undefined : LIST_TABS[to];
    if (to === null || next === undefined) return;
    event.preventDefault();
    buttons.current[to]?.focus();
    onTabChange(next);
  };

  return (
    <div className="fr-tabs" role="tablist" aria-label={t("friends.tabListLabel")}>
      {LIST_TABS.map((value, index) => (
        <button
          key={value}
          type="button"
          ref={(node) => {
            buttons.current[index] = node;
          }}
          className={value === tab ? "fr-tab on" : "fr-tab"}
          role="tab"
          id={tabId(idBase, value)}
          aria-selected={value === tab}
          aria-controls={panelId(idBase)}
          tabIndex={index === tabStop ? 0 : -1}
          onClick={() => onTabChange(value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {t(TAB_LABEL[value])}
          {value === "pending" && incoming > 0 ? (
            <span className="badge">{incoming}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
