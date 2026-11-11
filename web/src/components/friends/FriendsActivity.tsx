"use client";

import { useId } from "react";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/primitives/Avatar";
import type { ActiveFriendVM, OpenProfile } from "@/components/view-models";
import { PRESENCE_LABEL } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

export interface FriendsActivityProps {
  friends: ActiveFriendVM[];
  onOpenProfile: OpenProfile;
  onMessage: (userId: string) => void;
}

/** The live activity list beside Friends; it never appears beside a DM. */
export function FriendsActivity({ friends, onOpenProfile, onMessage }: FriendsActivityProps) {
  const { t } = useLanguage();
  const titleId = useId();

  return (
    <aside className="fr-activity" aria-labelledby={titleId}>
      <div className="fr-activity-header">
        <h3 id={titleId}>{t("friends.activeNow")}</h3>
        {friends.length > 0 ? <span aria-hidden="true">{friends.length}</span> : null}
      </div>

      {friends.length === 0 ? (
        <div className="fr-activity-empty">
          <h4>{t("friends.activityEmptyTitle")}</h4>
          <p>{t("friends.activityEmpty")}</p>
        </div>
      ) : (
        <ul className="fr-activity-list">
          {friends.map(({ person, customStatus, inCall, voiceChannel }) => (
            <li className="fr-activity-item" key={person.id}>
              <div className="fr-activity-person">
                <button
                  type="button"
                  className="fr-activity-profile"
                  aria-haspopup="dialog"
                  aria-label={t("profile.label", { name: person.displayName })}
                  aria-describedby={`${titleId}-${person.id}-status`}
                  onClick={(event) => onOpenProfile(person.id, event.currentTarget)}
                >
                  <Avatar
                    id={person.id}
                    displayName={person.displayName}
                    initials={person.initials}
                    avatarUrl={person.avatarUrl}
                    size="md"
                    presence={person.presence}
                  />
                  <span className="fr-activity-who">
                    <b>{person.displayName}</b>
                    <span
                      id={`${titleId}-${person.id}-status`}
                      className="fr-activity-status"
                      title={customStatus}
                    >
                      {customStatus ?? t(PRESENCE_LABEL[person.presence])}
                      {customStatus ? <span className="sr-only"> · {t(PRESENCE_LABEL[person.presence])}</span> : null}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="fr-activity-message"
                  title={t("profile.writeTo", { name: person.displayName })}
                  aria-label={t("profile.writeTo", { name: person.displayName })}
                  onClick={() => onMessage(person.id)}
                >
                  <Icon name="thread" size={16} />
                </button>
              </div>
              {inCall ? (
                <p className="fr-activity-context">
                  <Icon name={voiceChannel ? "speaker" : "phone"} size={15} />
                  <span>
                    <b>{t("profile.inCall")}</b>
                    {voiceChannel ? (
                      <span title={`${voiceChannel.name} · ${voiceChannel.serverName}`}>
                        {voiceChannel.name} · {voiceChannel.serverName}
                      </span>
                    ) : null}
                  </span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
