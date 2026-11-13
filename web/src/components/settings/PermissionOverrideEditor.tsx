"use client";

import { type CSSProperties, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { Segmented } from "@/components/primitives/Segmented";
import type { MessageKey } from "@/i18n";
import { SERVER_PERMISSION_VALUES } from "@/ports";
import type { PermissionOverride, Role, ServerPermission } from "@/ports";
import { useLanguage } from "@/state/hooks";

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

/** What one role's override changes, as the server stores it. */
export interface PermissionOverridePatch {
  allow: ServerPermission[];
  deny: ServerPermission[];
}

type Grant = "inherit" | "allow" | "deny";

const NO_OVERRIDE: PermissionOverridePatch = { allow: [], deny: [] };

function grantOf(patch: PermissionOverridePatch, permission: ServerPermission): Grant {
  if (patch.deny.includes(permission)) return "deny";
  return patch.allow.includes(permission) ? "allow" : "inherit";
}

function withGrant(
  patch: PermissionOverridePatch,
  permission: ServerPermission,
  grant: Grant,
): PermissionOverridePatch {
  const others = (list: ServerPermission[]) => list.filter((item) => item !== permission);
  return {
    allow: grant === "allow" ? [...others(patch.allow), permission] : others(patch.allow),
    deny: grant === "deny" ? [...others(patch.deny), permission] : others(patch.deny),
  };
}

function sameSet(a: ServerPermission[], b: ServerPermission[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function samePatch(a: PermissionOverridePatch, b: PermissionOverridePatch): boolean {
  return sameSet(a.allow, b.allow) && sameSet(a.deny, b.deny);
}

interface RoleRowProps {
  role: Role;
  override: PermissionOverride | undefined;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function RoleRow({ role, override, open, disabled, onToggle }: RoleRowProps) {
  const { t } = useLanguage();
  const allowCount = override?.allow.length ?? 0;
  const denyCount = override?.deny.length ?? 0;

  return (
    <div
      className={open ? "int-row perm-role on" : "int-row perm-role"}
      style={{ "--rc": role.color } as CSSProperties}
    >
      <span className="int-mark role" aria-hidden="true">
        <Icon name="shield" size={17} />
      </span>
      <span className="int-txt">
        <b className="role-name">{role.name}</b>
        <span className="perm-summary">
          {allowCount === 0 && denyCount === 0 ? (
            t("settings.permission.inheritsAll")
          ) : (
            <>
              {allowCount > 0 && (
                <span className="perm-tag allow">
                  {t("settings.permission.allowCount", { count: allowCount })}
                </span>
              )}
              {denyCount > 0 && (
                <span className="perm-tag deny">
                  {t("settings.permission.denyCount", { count: denyCount })}
                </span>
              )}
            </>
          )}
        </span>
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        aria-expanded={open}
        aria-label={t("settings.permission.editForRole", { name: role.name })}
        onClick={onToggle}
      >
        {open ? t("common.close") : t("settings.permission.edit")}
      </Button>
    </div>
  );
}

export interface PermissionOverrideEditorProps {
  /** False when this member may not manage roles: the editor stays walkable and read-only. */
  supported: boolean;
  roles: readonly Role[];
  overrides: readonly PermissionOverride[];
  onSave: (roleId: string, patch: PermissionOverridePatch) => Promise<void>;
}

/**
 * Per-role allow/deny narrowing for one channel or section, shared by the
 * permissions panes of `ChannelSettings` and `SectionSettings`.
 *
 * A role's base permissions come from the server's role editor and are always
 * the starting point; this only records where one channel or section departs
 * from them. So each permission is a three-way grant whose neutral middle
 * option is the default, and an untouched row reads "inherit", not "deny".
 */
export function PermissionOverrideEditor({
  supported,
  roles,
  overrides,
  onSave,
}: PermissionOverrideEditorProps) {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermissionOverridePatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const selected = roles.find((role) => role.id === selectedId);
  const saved = overrides.find((item) => item.roleId === selectedId) ?? NO_OVERRIDE;
  const current = draft ?? { allow: [...saved.allow], deny: [...saved.deny] };
  const dirty = !samePatch(current, saved);

  const toggleRole = (roleId: string) => {
    // Every open starts from what the server has, so a half-made edit on one
    // role never leaks into the next.
    setSelectedId(roleId === selectedId ? null : roleId);
    setDraft(null);
    setSaveError(false);
  };

  const save = async (roleId: string) => {
    setSaving(true);
    setSaveError(false);
    try {
      await onSave(roleId, current);
      setDraft(null);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.permissionOverridesUnsupported")}</p>}
      <div className="int-list perm-roles">
        {roles.map((role) => (
          <RoleRow
            key={role.id}
            role={role}
            override={overrides.find((item) => item.roleId === role.id)}
            open={role.id === selectedId}
            disabled={!supported}
            onToggle={() => toggleRole(role.id)}
          />
        ))}
      </div>

      {selected ? (
        <div className="perm-editor">
          <div className="perm-editor-head">
            <b>{t("settings.permission.forRole", { name: selected.name })}</b>
            <span>{t("settings.permission.legend")}</span>
          </div>
          <div className="perm-rows">
            {SERVER_PERMISSION_VALUES.map((permission) => {
              const label = t(PERMISSION_LABEL[permission]);
              return (
                <div className="perm-row" key={permission}>
                  <span className="perm-row-txt">{label}</span>
                  <Segmented
                    variant="pill"
                    className="perm-tri"
                    label={label}
                    value={grantOf(current, permission)}
                    disabled={!supported}
                    onChange={(grant) => setDraft(withGrant(current, permission, grant))}
                    options={[
                      { value: "inherit", label: t("settings.permission.inherit") },
                      { value: "allow", label: t("settings.permission.allow"), tone: "allow" },
                      { value: "deny", label: t("settings.permission.deny"), tone: "deny" },
                    ]}
                  />
                </div>
              );
            })}
          </div>
          <div className="perm-editor-foot">
            {saveError ? (
              <span className="frm-detail-error" role="alert">
                {t("settings.permission.saveFailed")}
              </span>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!supported || !dirty || saving}
              onClick={() => setDraft(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!supported || !dirty || saving}
              onClick={() => void save(selected.id)}
            >
              <Icon name="tick" size={15} />
              {saving ? t("common.saving") : t("settings.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
