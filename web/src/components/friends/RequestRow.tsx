"use client";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import type { FriendRequestVM } from "@/components/view-models";
import { useLanguage } from "@/state/LanguageProvider";

import { FriendIdentity } from "./FriendIdentity";

export interface RequestRowProps {
  request: FriendRequestVM;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onOpenProfile: (anchor: HTMLElement) => void;
}

/** A pending request: answered when it came to you, withdrawn when it left. */
export function RequestRow({
  request,
  onAccept,
  onDecline,
  onCancel,
  onOpenProfile,
}: RequestRowProps) {
  const { t } = useLanguage();
  const { person } = request;
  const incoming = request.direction === "incoming";

  return (
    <li className="fr-row">
      <FriendIdentity
        person={person}
        username={request.username}
        state={`${incoming ? t("friends.incoming") : t("friends.outgoing")} · ${request.when}`}
        presence={person.presence}
        onOpenProfile={onOpenProfile}
      />
      <span className="fr-acts">
        {incoming ? (
          <>
            <button
              type="button"
              className="fr-act ok"
              title={t("friends.accept")}
              aria-label={t("friends.acceptFrom", { name: person.displayName })}
              onClick={onAccept}
            >
              <Icon name="tick" size={17} />
            </button>
            <button
              type="button"
              className="fr-act no"
              title={t("friends.decline")}
              aria-label={t("friends.declineFrom", { name: person.displayName })}
              onClick={onDecline}
            >
              <Icon name="x" size={17} />
            </button>
          </>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            {t("friends.cancel")}
          </Button>
        )}
      </span>
    </li>
  );
}
