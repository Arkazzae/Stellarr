"use client";

import { Fragment, useId, useState } from "react";

import { Icon, type IconName } from "@stellarr/ui/icons";
import { DialogClose } from "@/components/primitives/DialogClose";
import { Modal } from "@/components/primitives/Modal";
import {
  PermissionOverrideEditor,
  type PermissionOverridePatch,
} from "@/components/settings/PermissionOverrideEditor";
import { SettingsSection } from "@/components/settings/SettingsSection";
import type { Translator } from "@/i18n";
import type { PermissionOverride, Role } from "@/ports";
import { useLanguage } from "@/state/hooks";

type PaneKey = "general" | "permissions" | "danger";

export interface SectionSettingsVM {
  id: string;
  name: string;
}

export interface SectionSettingsProps {
  open: boolean;
  onClose: () => void;
  /** Null while the dialog is closing and the rail has moved on. */
  section: SectionSettingsVM | null;
  /** False when this member may not manage channels: the form stays legible and read-only. */
  supported: boolean;
  /** False when this member may not manage roles, so overrides are read-only. */
  permissionsSupported: boolean;
  roles: readonly Role[];
  permissionOverrides: readonly PermissionOverride[];
  onSave: (patch: { name: string }) => Promise<void>;
  onSavePermissionOverride: (roleId: string, patch: PermissionOverridePatch) => Promise<void>;
  onDelete: () => Promise<void>;
  /** True when the server refused deletion because the section still has channels. */
  deleteBlocked: boolean;
  onOpenRoles: () => void;
}

interface NavItem {
  key: PaneKey;
  label: string;
  icon: IconName;
  detail: string;
  danger?: boolean;
}

interface NavGroup {
  caption: string;
  items: readonly NavItem[];
}

/** Grouped like the channel and server dialogs, so the three shells match. */
function navigationFor(t: Translator): readonly NavGroup[] {
  return [
    {
      caption: t("section.title"),
      items: [
        {
          key: "general",
          label: t("settings.general"),
          icon: "folder",
          detail: t("section.nameDetail"),
        },
      ],
    },
    {
      caption: t("settings.access"),
      items: [
        {
          key: "permissions",
          label: t("channel.permissions"),
          icon: "shield",
          detail: t("section.permissionsDetail"),
        },
      ],
    },
    {
      caption: t("settings.other"),
      items: [
        {
          key: "danger",
          label: t("section.delete"),
          icon: "trash",
          detail: t("section.deleteDetail"),
          danger: true,
        },
      ],
    },
  ];
}

export function SectionSettings({
  open,
  onClose,
  section,
  supported,
  permissionsSupported,
  roles,
  permissionOverrides,
  onSave,
  onSavePermissionOverride,
  onDelete,
  deleteBlocked,
  onOpenRoles,
}: SectionSettingsProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const nameFieldId = useId();
  const [name, setName] = useState(section?.name ?? "");
  const [active, setActive] = useState<PaneKey>("general");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset while rendering, not in an effect, so reopening the dialog (on the
  // same section or another) never lands on whichever pane was left active.
  const [previous, setPrevious] = useState({ section, open });
  if (previous.section !== section || previous.open !== open) {
    setPrevious({ section, open });
    setName(section?.name ?? "");
    setActive("general");
    setConfirmingDelete(false);
    setBusy(false);
    setActionError(null);
  }

  const navigation = navigationFor(t);
  const current = navigation.flatMap((group) => group.items).find((item) => item.key === active);
  const trimmed = name.trim();
  const canSave =
    supported && !busy && section !== null && trimmed.length > 0 && trimmed !== section.name;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setActionError(null);
    try {
      await onSave({ name: trimmed });
    } catch {
      setActionError(t("section.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setConfirmingDelete(false);
    setBusy(true);
    setActionError(null);
    try {
      await onDelete();
    } catch {
      setActionError(t("section.deleteFailed"));
      setConfirmingDelete(true);
    } finally {
      setBusy(false);
    }
  };

  const renderPane = () => {
    switch (active) {
      case "general":
        return (
          <SettingsSection title={t("section.name")} icon="folder" bodyClassName="ch-settings-form">
            <div className="frm">
              <div className="frm-row">
                <label className="frm-lab" htmlFor={nameFieldId}>
                  {t("section.name")}
                  <span>{t("section.nameDetail")}</span>
                </label>
                <div className="frm-ctl">
                  <input
                    id={nameFieldId}
                    className="set-input"
                    type="text"
                    value={name}
                    maxLength={60}
                    disabled={!supported}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </SettingsSection>
        );
      case "permissions":
        return (
          <SettingsSection title={t("channel.channelPermissions")} icon="shield">
            <p className="fld-note">{t("section.permissionsDetailText")}</p>
            {roles.length === 0 ? (
              <p className="fld-note">{t("channel.noRoles")}</p>
            ) : (
              <PermissionOverrideEditor
                supported={permissionsSupported}
                roles={roles}
                overrides={permissionOverrides}
                onSave={onSavePermissionOverride}
              />
            )}
            <button type="button" className="btn-ghost sm" onClick={onOpenRoles}>
              <Icon name="shield" size={15} />
              {t("channel.openServerRoles")}
            </button>
          </SettingsSection>
        );
      case "danger":
        return (
          <SettingsSection title={t("section.delete")} icon="trash" className="danger-section">
            <p className="fld-note">{t("section.deleteWarning")}</p>
            {deleteBlocked ? (
              <p className="set-note sound-error" role="alert">
                {t("section.deleteBlocked")}
              </p>
            ) : null}
            {confirmingDelete ? (
              <div className="ch-confirm">
                <button
                  type="button"
                  className="btn-danger sm"
                  disabled={!supported || busy}
                  onClick={() => void confirmDelete()}
                >
                  <Icon name="trash" size={15} />
                  {section === null
                    ? t("section.delete")
                    : t("settings.deleteNamedServer", { name: section.name })}
                </button>
                <button
                  type="button"
                  className="btn-ghost sm"
                  onClick={() => setConfirmingDelete(false)}
                >
                  <Icon name="x" size={14} />
                  {t("common.cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-danger sm"
                disabled={!supported}
                onClick={() => setConfirmingDelete(true)}
              >
                <Icon name="trash" size={15} />
                {t("section.delete")}
              </button>
            )}
          </SettingsSection>
        );
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} className="sv-wrap">
      <div className="sv ch-settings">
        <div className="sv-bar">
          <div className="sv-bar-txt">
            <h2>{current?.label}</h2>
            <p>{current?.detail}</p>
          </div>
          <DialogClose label={t("common.close")} onClose={onClose} />
        </div>

        <aside className="sv-nav">
          <div className="sv-brand ch-settings-brand">
            <span className="ch-settings-mark" aria-hidden="true">
              <Icon name="folder" size={20} />
            </span>
            <span className="sv-brand-txt">
              <b
                id={titleId}
                aria-label={
                  section === null ? undefined : t("settings.editSection", { name: section.name })
                }
              >
                {section?.name ?? t("section.title")}
              </b>
              <span>{t("section.title")}</span>
            </span>
          </div>
          <nav className="sv-nav-scroll" aria-label={t("section.settingsSections")}>
            {navigation.map((group) => (
              <Fragment key={group.caption}>
                <div className="sv-cap">{group.caption}</div>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`sv-item${item.key === active ? " on" : ""}${item.danger ? " danger" : ""}`}
                    aria-current={item.key === active ? "page" : undefined}
                    onClick={() => setActive(item.key)}
                  >
                    <span className="sv-ico" aria-hidden="true">
                      <Icon name={item.icon} size={18} />
                    </span>
                    {item.label}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>
        </aside>

        <div className="sv-main">
          <div className="sv-panes">
            <section className="sv-pane on" data-pane={active} key={active}>
              {supported ? null : <p className="set-note">{t("channel.settingsUnsupported")}</p>}
              {renderPane()}
            </section>
          </div>
          <footer className="ch-settings-foot">
            {actionError === null ? null : (
              <span className="frm-detail-error" role="alert">
                {actionError}
              </span>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>
              <Icon name="x" size={15} />
              {t("common.close")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canSave}
              onClick={() => void save()}
            >
              <Icon name="tick" size={15} />
              {busy ? t("common.saving") : t("channel.settingsSave")}
            </button>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
