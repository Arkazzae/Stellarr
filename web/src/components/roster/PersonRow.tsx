"use client";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/primitives/Avatar";
import { useContextMenu } from "@/components/primitives/ContextMenu";
import type { PersonVM } from "@/components/view-models";
import type { Translator } from "@/i18n";
import { useLanguage } from "@/state/LanguageProvider";

import { UserMenu, type UserMenuActions } from "./UserMenu";

/**
 * What the second line of a person's row says.
 *
 * Someone in the call is described by their microphone, not by their presence:
 * "W sieci" next to a person who is talking to you is noise.
 */
export function personState(person: PersonVM, inCall: boolean, t: Translator): string {
  if (inCall) return person.speaking ? t("roster.speaking") : t("roster.silent");
  return t(`presence.${person.presence}`);
}

export interface PersonRowProps {
  person: PersonVM;
  /** In-call rows drop the presence dot and show speech instead. */
  inCall?: boolean;
  /** Raises the mini profile beside the row. Absent leaves the row inert. */
  onOpenProfile?: (anchor: HTMLElement) => void;
  /** What the row's menu can do. Absent leaves the browser's own menu alone. */
  menu?: UserMenuActions & { self?: boolean };
}

/**
 * One person in a list.
 *
 * The row itself opens their profile. Where there are actions, a separate
 * trailing button opens the same menu as a right-click, so touch users do not
 * have to discover a desktop gesture.
 */
export function PersonRow({ person, inCall = false, onOpenProfile, menu }: PersonRowProps) {
  // The menu remembers the element it was raised from, so a profile opened out
  // of it hangs off the row or the button rather than off the pointer.
  const contextMenu = useContextMenu();
  const { t } = useLanguage();

  const classes = [
    "person",
    menu !== undefined && "has-menu",
    inCall && person.speaking && "speaking",
    person.presence === "offline" && "offline",
  ]
    .filter(Boolean)
    .join(" ");

  // The dot on the avatar already says "online" and the accent ring already
  // says "speaking"; the words are there for anyone who cannot see either.
  const face = (
    <>
      <Avatar
        id={person.id}
        displayName={person.displayName}
        initials={person.initials}
        avatarUrl={person.avatarUrl}
        presence={inCall ? undefined : person.presence}
        speaking={inCall && person.speaking}
      />
      <span className="who">
        <b>{person.displayName}</b>
        <span className="sr-only">{personState(person, inCall, t)}</span>
      </span>
    </>
  );

  return (
    <div
      className={classes}
      onContextMenu={menu === undefined ? undefined : contextMenu.onContextMenu}
    >
      {menu === undefined || contextMenu.at === null ? null : (
        <UserMenu
          {...menu}
          at={contextMenu.at}
          userId={person.id}
          displayName={person.displayName}
          anchor={contextMenu.anchor}
          onClose={contextMenu.close}
        />
      )}
      {onOpenProfile === undefined ? (
        face
      ) : (
        <button
          type="button"
          className="person-main"
          aria-haspopup="dialog"
          onClick={(event) => onOpenProfile(event.currentTarget)}
        >
          {face}
        </button>
      )}
      {menu === undefined ? null : (
        <button
          type="button"
          className="person-more"
          aria-label={t("common.moreActions", { name: person.displayName })}
          aria-haspopup="menu"
          aria-expanded={contextMenu.at !== null}
          onClick={(event) => {
            const trigger = event.currentTarget;
            const { right, bottom } = trigger.getBoundingClientRect();
            contextMenu.openAt(trigger, right, bottom + 4);
          }}
        >
          <Icon name="dots" size={15} />
        </button>
      )}
    </div>
  );
}
