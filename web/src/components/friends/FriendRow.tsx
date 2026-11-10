"use client";

import { useState } from "react";

import { blockPerson, removeFriend } from "@/components/confirmations";
import { Icon } from "@/components/icons/Icon";
import { AnchoredCard } from "@/components/primitives/AnchoredCard";
import { useConfirm, type ConfirmRequest } from "@/components/primitives/ConfirmDialog";
import type { PersonVM } from "@/components/view-models";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/LanguageProvider";

import { FriendIdentity } from "./FriendIdentity";

const PRESENCE_WORD: Record<PersonVM["presence"], MessageKey> = {
  online: "presence.online",
  idle: "presence.idle",
  dnd: "presence.dnd",
  offline: "presence.offline",
};

export interface FriendRowProps {
  person: PersonVM;
  username: string;
  /** The second line. The presence word stands in when there is none. */
  detail?: string;
  onMessage: () => void;
  onCall: () => void;
  onRemove: () => void;
  onBlock: () => void;
  /** Raises the mini profile beside the row. */
  onOpenProfile: (anchor: HTMLElement) => void;
}

/**
 * One friend.
 *
 * Writing to them stays one click away. On a wide screen so does calling; on a
 * phone the call moves into the menu, so the name is not crushed by three
 * 44px touch targets. The two actions that end a relationship stay behind the
 * menu, where a stray tap cannot reach them, and both ask before acting.
 */
export function FriendRow({
  person,
  username,
  detail,
  onMessage,
  onCall,
  onRemove,
  onBlock,
  onOpenProfile,
}: FriendRowProps) {
  const confirm = useConfirm();
  const { t } = useLanguage();
  const phone = useMediaQuery("(max-width: 767px)", false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);

  const moreActions = t("common.moreActions", { name: person.displayName });
  const callLabel = `${t("common.call")} ${person.displayName}`;

  // The menu closes on the way to the question, whatever the answer.
  const confirmThen = (request: ConfirmRequest, act: () => void) => {
    setMenuAnchor(null);
    void confirm(request).then((confirmed) => {
      if (confirmed) act();
    });
  };

  return (
    <li className={person.presence === "offline" ? "fr-row offline" : "fr-row"}>
      <FriendIdentity
        person={person}
        username={username}
        state={detail ?? t(PRESENCE_WORD[person.presence])}
        presence={person.presence}
        onOpenProfile={onOpenProfile}
      />

      <span className="fr-acts">
        <button
          type="button"
          className="fr-act"
          title={t("profile.writeTo", { name: person.displayName })}
          aria-label={t("profile.writeTo", { name: person.displayName })}
          onClick={onMessage}
        >
          <Icon name="thread" size={16} />
        </button>
        <button
          type="button"
          className="fr-act fr-direct-call"
          title={callLabel}
          aria-label={callLabel}
          onClick={onCall}
        >
          <Icon name="phone" size={16} />
        </button>
        <button
          type="button"
          className="fr-act"
          title={t("voiceBar.more")}
          aria-label={moreActions}
          aria-haspopup="dialog"
          aria-expanded={menuAnchor !== null}
          onClick={(event) => {
            const trigger = event.currentTarget;
            setMenuAnchor((open) => (open === null ? trigger : null));
          }}
        >
          <Icon name="dots" size={16} />
        </button>
      </span>

      {menuAnchor === null ? null : (
        <AnchoredCard
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          label={moreActions}
          className="fr-pop"
        >
          {phone ? (
            <button
              type="button"
              className="fr-menu-item"
              onClick={() => {
                setMenuAnchor(null);
                onCall();
              }}
            >
              <Icon name="phone" size={15} />
              {t("common.call")}
            </button>
          ) : null}
          <button
            type="button"
            className="fr-menu-item"
            onClick={() => confirmThen(removeFriend(t, person.displayName), onRemove)}
          >
            {t("common.removeFriend")}
          </button>
          <button
            type="button"
            className="fr-menu-item danger"
            onClick={() => confirmThen(blockPerson(t, person.displayName), onBlock)}
          >
            {t("common.block")}
          </button>
        </AnchoredCard>
      )}
    </li>
  );
}
