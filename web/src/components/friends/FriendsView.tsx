"use client";

import { useId, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons/Icon";
import type { FriendRequestVM, FriendsTab, FriendVM } from "@/components/view-models";
import type { AddFriendResult } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

import { AddFriendPanel } from "./AddFriendPanel";
import { FriendsLists, type FriendsListActions } from "./FriendsLists";
import { FriendsTabList, panelId, tabId } from "./FriendsTabList";
import { useAddFriend } from "./useAddFriend";

export interface FriendsViewProps extends FriendsListActions {
  tab: FriendsTab;
  onTabChange: (tab: FriendsTab) => void;
  friends: FriendVM[];
  requests: FriendRequestVM[];
  blocked: FriendVM[];
  /** False adds the one line that says none of this reaches the server. */
  supported: boolean;
  /** The burger, which only exists below 768 where the rail is a drawer. */
  railOpen: boolean;
  onToggleRail: () => void;
  onAddFriend: (username: string) => Promise<AddFriendResult>;
  notificationButton?: ReactNode;
}

/**
 * The Friends view.
 *
 * The room, showing people instead of messages: same header height, same
 * 860px cap, same row rhythm as the roster, so moving between a channel and
 * this does not feel like moving between two applications.
 */
export function FriendsView({
  tab,
  onTabChange,
  friends,
  requests,
  blocked,
  supported,
  railOpen,
  onToggleRail,
  onAddFriend,
  notificationButton,
  ...actions
}: FriendsViewProps) {
  const { t } = useLanguage();
  const idBase = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const form = useAddFriend(onAddFriend);

  const adding = tab === "add";
  const incoming = requests.filter((request) => request.direction === "incoming").length;

  return (
    <main className="room friends">
      <header className="room-header">
        <button
          type="button"
          className="burger"
          aria-label={t("common.showConversations")}
          aria-expanded={railOpen}
          onClick={onToggleRail}
        >
          <Icon name="list" size={18} />
        </button>
        <span className="glyph" aria-hidden="true">
          <Icon name="users" size={18} />
        </span>
        <h2>{t("friends.title")}</h2>

        <FriendsTabList
          tab={tab}
          onTabChange={onTabChange}
          incoming={incoming}
          idBase={idBase}
        />

        {notificationButton}

        {/* Outside the tablist on purpose: it opens a form, not one more list.
            It is the app's primary button because it does the same kind of
            thing as "New link" or "Add channel"; below 768 only the icon
            survives and `aria-label` keeps the name. */}
        <button
          type="button"
          className={adding ? "btn-primary sm fr-add on" : "btn-primary sm fr-add"}
          aria-pressed={adding}
          aria-label={t("friends.addFriend")}
          onClick={() => onTabChange("add")}
        >
          <Icon name="userAdd" size={15} />
          <span className="fr-add-label">{t("friends.addFriend")}</span>
        </button>
      </header>

      <div
        className="fr-body"
        id={panelId(idBase)}
        role="tabpanel"
        aria-labelledby={adding ? undefined : tabId(idBase, tab)}
      >
        <div className="fr-inner">
          {supported ? null : <p className="fr-note">{t("friends.unsupported")}</p>}

          {adding ? (
            <AddFriendPanel form={form} />
          ) : (
            <>
              <div className="fr-find">
                <span className="glyph" aria-hidden="true">
                  <Icon name="search" size={15} />
                </span>
                <label className="sr-only" htmlFor={searchId}>
                  {t("friends.searchFriends")}
                </label>
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  placeholder={t("friends.searchPlaceholder")}
                  autoComplete="off"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <FriendsLists
                {...actions}
                tab={tab}
                query={query}
                friends={friends}
                requests={requests}
                blocked={blocked}
                onAddFriend={() => onTabChange("add")}
                onClearSearch={() => setQuery("")}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
