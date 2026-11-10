"use client";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/primitives/Avatar";
import { IconButton } from "@/components/primitives/IconButton";
import { PersonRow, personState } from "@/components/roster/PersonRow";
import type { UserMenuActions } from "@/components/roster/UserMenu";
import type { OpenProfile, PersonVM } from "@/components/view-models";
import { useLanguage } from "@/state/LanguageProvider";

/**
 * What a right-click on a person can do here. The roster fills in who was
 * clicked, and marks the row of `selfId` as yours.
 */
export type RosterMenu = UserMenuActions & { selfId?: string };

export interface RosterProps {
  open: boolean;
  /**
   * 1024-1439 with the full list closed: the panel is still on screen as the
   * avatar column, so it must stay reachable even though `open` is false.
   */
  mini?: boolean;
  /** Everyone reachable, whether `online`, `idle` or `dnd`. */
  online: PersonVM[];
  offline: PersonVM[];
  /** People currently in a call. Decides how a row reports speech, never grouping. */
  voiceUserIds: ReadonlySet<string>;
  onExpand: () => void;
  onCollapse: () => void;
  /** Raises the mini profile beside the row, or beside the mini avatar. */
  onOpenProfile: OpenProfile;
  /** Right-click on a person. Absent leaves the browser's own menu alone. */
  menu?: RosterMenu;
}

interface PersonGroupProps {
  label: string;
  people: PersonVM[];
  voiceUserIds: ReadonlySet<string>;
  onOpenProfile: OpenProfile;
  menu?: RosterMenu;
}

/**
 * A caption plus its rows. An empty group renders nothing rather than a
 * heading with a zero next to it.
 */
export function PersonGroup({
  label,
  people,
  voiceUserIds,
  onOpenProfile,
  menu,
}: PersonGroupProps) {
  if (people.length === 0) return null;

  const rowMenu = (personId: string) => {
    if (menu === undefined) return undefined;
    const { selfId, ...actions } = menu;
    return { ...actions, self: personId === selfId };
  };

  return (
    <section className="roster-group">
      <h4 className="group-caption">
        {label}
        <span className="count">{people.length}</span>
      </h4>
      <div className="person-list">
        {people.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            inCall={voiceUserIds.has(person.id)}
            onOpenProfile={(anchor) => onOpenProfile(person.id, anchor)}
            menu={rowMenu(person.id)}
          />
        ))}
      </div>
    </section>
  );
}

/** The panel of people: a column of faces, and beside it the full grouped list. */
export function Roster({
  open,
  mini = false,
  online,
  offline,
  voiceUserIds,
  onExpand,
  onCollapse,
  onOpenProfile,
  menu,
}: RosterProps) {
  const { t } = useLanguage();
  // Closed, the panel is a zero-width track or an off-screen drawer but still in
  // the document, so it has to leave the tab order and the accessibility tree
  // rather than just be invisible.
  const hidden = !open && !mini;

  return (
    // `inert` is how a closed drawer is hidden. A simultaneous `aria-hidden` is
    // rejected by Chromium while the close control still has focus.
    <aside className="roster" aria-label={t("roster.people")} inert={hidden}>
      <div className="roster-mini">
        <IconButton
          icon="caretL"
          size={16}
          label={t("roster.expand")}
          title={t("roster.expand")}
          onClick={onExpand}
        />
        <div className="mini-list">
          {[...online, ...offline].map((person) => {
            const inCall = voiceUserIds.has(person.id);
            // There is no name in this column, so the face is the control and
            // carries the name and state itself.
            const description = `${person.displayName} — ${personState(person, inCall, t)}`;
            return (
              <Avatar
                key={person.id}
                id={person.id}
                displayName={person.displayName}
                initials={person.initials}
                avatarUrl={person.avatarUrl}
                dim={person.presence === "offline"}
                speaking={inCall && person.speaking}
                presence={inCall ? undefined : person.presence}
                label={description}
                title={description}
                onOpen={(anchor) => onOpenProfile(person.id, anchor)}
              />
            );
          })}
        </div>
      </div>

      <div className="roster-inner">
        <div className="roster-head">
          <span className="glyph">
            <Icon name="users" size={19} />
          </span>
          <h3>{t("roster.people")}</h3>
          <IconButton
            icon="x"
            size={17}
            label={t("roster.collapse")}
            title={t("roster.collapse")}
            onClick={onCollapse}
          />
        </div>

        <div className="roster-list">
          <PersonGroup
            label={t("presence.online")}
            people={online}
            voiceUserIds={voiceUserIds}
            onOpenProfile={onOpenProfile}
            menu={menu}
          />
          <PersonGroup
            label={t("presence.offline")}
            people={offline}
            voiceUserIds={voiceUserIds}
            onOpenProfile={onOpenProfile}
            menu={menu}
          />
          {online.length + offline.length === 0 ? (
            <p className="roster-empty">{t("roster.empty")}</p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
