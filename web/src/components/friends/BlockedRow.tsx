"use client";

import type { FriendVM } from "@/components/view-models";
import { useLanguage } from "@/state/LanguageProvider";

import { FriendIdentity } from "./FriendIdentity";

export interface BlockedRowProps {
  entry: FriendVM;
  onUnblock: () => void;
  onOpenProfile: (anchor: HTMLElement) => void;
}

/** Someone you blocked. The only thing to do with them is undo it. */
export function BlockedRow({ entry, onUnblock, onOpenProfile }: BlockedRowProps) {
  const { t } = useLanguage();
  return (
    <li className="fr-row offline">
      <FriendIdentity
        person={entry.person}
        username={entry.username}
        state={t("friends.blockedDetail")}
        onOpenProfile={onOpenProfile}
      />
      <span className="fr-acts">
        <button type="button" className="btn-ghost sm" onClick={onUnblock}>
          {t("common.unblock")}
        </button>
      </span>
    </li>
  );
}
