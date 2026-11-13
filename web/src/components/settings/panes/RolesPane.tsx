"use client";

import { type CSSProperties, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";
import { countedNoun } from "@/components/settings/panes/paneFormat";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { InterfaceLocale, MessageKey, Translator } from "@/i18n";
import { SERVER_PERMISSION_VALUES } from "@/ports";
import type { Role, RoleInput, ServerPermission } from "@/ports";
import { useLanguage } from "@/state/hooks";

const NEW_ROLE_COLOR = "#8b7cf6";

const PERMISSION_LABEL: Record<ServerPermission, MessageKey> = {
  manageServer: "settings.permission.manageServer",
  manageChannels: "settings.permission.manageChannels",
  manageRoles: "settings.permission.manageRoles",
  manageMembers: "settings.permission.manageMembers",
  manageMessages: "settings.permission.manageMessages",
  moderateMembers: "settings.permission.moderateMembers",
  manageBans: "settings.permission.manageBans",
  viewAuditLog: "settings.permission.viewAuditLog",
};

/**
 * What a role is, as one glyph: the strongest thing it can do, so the list can
 * be scanned by shape before any name is read. Derived from the permissions
 * themselves, so there is no second field to keep in sync.
 */
function roleIcon(role: Role): IconName {
  const can = (permission: ServerPermission) => role.permissions.includes(permission);
  if (role.isOwner) return "medal";
  if (can("manageServer")) return "server";
  if (can("manageRoles") || can("manageMembers")) return "shield";
  if (can("manageBans") || can("moderateMembers") || can("manageMessages")) return "ban";
  if (can("manageChannels")) return "hash";
  if (can("viewAuditLog")) return "list";
  return "users";
}

/** The line under the name: who is in the role and what it may do. */
function roleSummary(role: Role, t: Translator, locale: InterfaceLocale): string {
  const count = role.permissions.length;
  const what = role.isOwner
    ? t("settings.roleOwner")
    : count === 0
      ? t("settings.roleNoPermissions")
      : count === SERVER_PERMISSION_VALUES.length
        ? t("settings.roleAllPermissions")
        : countedNoun(t, locale, "settings.permission", count);
  return `${countedNoun(t, locale, "settings.member", role.memberCount)} · ${what}`;
}

export interface RolesPaneProps {
  supported: boolean;
  roles: readonly Role[];
  onCreate: (input: RoleInput) => Promise<void>;
  onUpdate: (roleId: string, patch: RoleInput) => Promise<void>;
  onDelete: (roleId: string) => Promise<void>;
}

/** The role open in the editor, with the edits not yet saved. */
interface Editing {
  roleId: string;
  draft: RoleInput;
}

export function RolesPane({ supported, roles, onCreate, onUpdate, onDelete }: RolesPaneProps) {
  const { locale, t } = useLanguage();
  const [editing, setEditing] = useState<Editing | null>(null);
  const action = useAsyncAction();
  const selected = roles.find((role) => role.id === editing?.roleId);

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.rolesUnsupported")}</p>}
      <SettingsSection
        title={t("server.roles")}
        icon="shield"
        count={roles.length}
        countLabel={t("settings.rolesCount", { count: roles.length })}
        action={
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="asset-add"
            disabled={!supported || action.pending}
            onClick={() =>
              void action.run(() =>
                onCreate({ name: t("settings.newRole"), color: NEW_ROLE_COLOR, permissions: [] }),
              )
            }
          >
            <Icon name="plus" size={15} />
            {t("settings.newRole")}
          </Button>
        }
      >
        {action.failed ? (
          <p className="set-note sound-error" role="alert">
            {t("settings.roleActionFailed")}
          </p>
        ) : null}
        {roles.length === 0 ? (
          <div className="asset-empty">
            <Icon name="shield" size={24} />
            <b>{t("settings.noRoles")}</b>
            <span>{t("settings.noRolesDetail")}</span>
          </div>
        ) : (
          <div className="int-list">
            {roles.map((role) => (
              // The colour is published once, as a variable, and read by both the
              // mark and the name, so a role is the same colour wherever it is
              // written and nothing else on the row has to know the hex.
              <div className="int-row" key={role.id} style={{ "--rc": role.color } as CSSProperties}>
                <span className="int-mark role" aria-hidden="true">
                  <Icon name={roleIcon(role)} size={17} />
                </span>
                <span className="int-txt">
                  <b className="role-name">{role.name}</b>
                  <span>{roleSummary(role, t, locale)}</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!supported || action.pending}
                  aria-label={t("settings.rolePermissionsLabel", { name: role.name })}
                  onClick={() =>
                    setEditing({
                      roleId: role.id,
                      draft: {
                        name: role.name,
                        color: role.color,
                        permissions: [...role.permissions],
                      },
                    })
                  }
                >
                  {t("settings.rolePermissions")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
      {selected && editing ? (
        <RoleEditor
          role={selected}
          draft={editing.draft}
          supported={supported}
          busy={action.pending}
          onChange={(draft) => setEditing({ roleId: selected.id, draft })}
          onSave={() => void action.run(() => onUpdate(selected.id, editing.draft))}
          onDelete={() =>
            void action.run(async () => {
              await onDelete(selected.id);
              setEditing(null);
            })
          }
        />
      ) : null}
    </>
  );
}

interface RoleEditorProps {
  role: Role;
  draft: RoleInput;
  supported: boolean;
  busy: boolean;
  onChange: (draft: RoleInput) => void;
  onSave: () => void;
  onDelete: () => void;
}

function RoleEditor({ role, draft, supported, busy, onChange, onSave, onDelete }: RoleEditorProps) {
  const { t } = useLanguage();
  // The owner role is fixed; every field and the save button stay off for it.
  const locked = !supported || role.isOwner;

  return (
    <SettingsSection
      title={t("settings.rolePermissionsTitle", { name: role.name })}
      icon={roleIcon(role)}
      className="role-editor"
    >
      <div className="role-editor-fields">
        <label>
          <span>{t("settings.roleName")}</span>
          <input
            className="set-input"
            value={draft.name}
            disabled={locked}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          <span>{t("settings.roleColor")}</span>
          <input
            className="set-input"
            value={draft.color}
            disabled={locked}
            onChange={(event) => onChange({ ...draft, color: event.target.value })}
          />
        </label>
      </div>
      <div className="set-list">
        {SERVER_PERMISSION_VALUES.map((permission) => (
          <label className="set-item role-permission" key={permission}>
            <input
              type="checkbox"
              checked={draft.permissions.includes(permission)}
              disabled={locked}
              onChange={(event) =>
                onChange({
                  ...draft,
                  permissions: event.target.checked
                    ? [...draft.permissions, permission]
                    : draft.permissions.filter((item) => item !== permission),
                })
              }
            />
            <span className="set-item-txt">
              <b>{t(PERMISSION_LABEL[permission])}</b>
            </span>
          </label>
        ))}
      </div>
      <div className="sv-head">
        <Button
          type="button"
          variant="primary"
          className="role-save"
          disabled={locked || busy || draft.name.trim() === ""}
          onClick={onSave}
        >
          {t("settings.save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!supported || busy || role.isSystem}
          onClick={onDelete}
        >
          {t("settings.deleteRole")}
        </Button>
      </div>
    </SettingsSection>
  );
}
