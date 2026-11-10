"use client";

import type { CSSProperties } from "react";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/primitives/Avatar";
import { formatShortDate } from "@/components/settings/panes/paneFormat";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { AdminMember, Role } from "@/ports";
import { useLanguage } from "@/state/hooks";

export interface MembersPaneProps {
  supported: boolean;
  members: readonly AdminMember[];
  /** Looked up by `member.roleId`; the chip's colour comes from the role. */
  roles: readonly Role[];
  onAssignRole: (userId: string, roleId: string) => Promise<void>;
}

export function MembersPane({ supported, members, roles, onAssignRole }: MembersPaneProps) {
  const { locale, t } = useLanguage();
  const assign = useAsyncAction();
  const roleById = new Map(roles.map((role) => [role.id, role]));

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.membersUnsupported")}</p>}
      <SettingsSection
        title={t("server.members")}
        icon="users"
        count={members.length}
        countLabel={t("settings.membersCount", { count: members.length })}
      >
        {assign.failed ? (
          <p className="set-note sound-error" role="alert">
            {t("settings.memberActionFailed")}
          </p>
        ) : null}
        {members.length === 0 ? (
          <div className="asset-empty">
            <Icon name="users" size={24} />
            <b>{t("settings.noPeople")}</b>
            <span>{t("settings.noMembers")}</span>
          </div>
        ) : (
          <div className="set-list">
            {members.map((member) => {
              const role = roleById.get(member.roleId);
              // The owner's role is fixed, so it is shown as a chip, never a menu.
              const canAssign = supported && role?.isOwner !== true;
              return (
                <div className="set-item" key={member.user.id}>
                  <Avatar
                    id={member.user.id}
                    displayName={member.user.displayName}
                    avatarUrl={member.user.avatarUrl}
                    size="md"
                  />
                  <span className="set-item-txt">
                    <b>{member.user.displayName}</b>
                    <span>
                      {t("settings.memberJoined", {
                        date: formatShortDate(member.joinedAt, locale),
                      })}
                    </span>
                  </span>
                  {canAssign ? (
                    <select
                      className="set-select member-role-select"
                      aria-label={t("settings.memberRole", { name: member.user.displayName })}
                      value={member.roleId}
                      disabled={assign.pending}
                      onChange={(event) =>
                        void assign.run(() => onAssignRole(member.user.id, event.target.value))
                      }
                    >
                      {roles
                        .filter((item) => !item.isOwner || item.id === member.roleId)
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  ) : role ? (
                    <span className="role-chip" style={{ "--rc": role.color } as CSSProperties}>
                      {role.name}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
