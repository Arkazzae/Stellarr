"use client";

import { useMemo, useState } from "react";

import { SectionCreate } from "@/components/settings/SectionCreate";
import {
  SectionSettings,
  type SectionSettingsVM,
} from "@/components/settings/SectionSettings";
import { ApiError, describeError } from "@/lib/api/errors";
import type { Role } from "@/ports";
import { useDirectory, useLanguage, usePorts, useUi } from "@/state/hooks";

import { usePermissionOverrides } from "./usePermissionOverrides";

/** The cog on a rail section header: its name, permissions and deletion. */
export function SectionSettingsDialog({ roles }: { roles: readonly Role[] }) {
  const { admin } = usePorts();
  const directory = useDirectory();
  const ui = useUi();

  const sectionId = ui.modal === "section" ? ui.sectionSettingsId : null;
  const { overrides, save } = usePermissionOverrides("section", sectionId);

  // Cleared while rendering so another section, or reopening this one, never
  // starts with the last attempt's banner.
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [seed, setSeed] = useState(sectionId);
  if (seed !== sectionId) {
    setSeed(sectionId);
    setDeleteBlocked(false);
  }

  const section = useMemo<SectionSettingsVM | null>(() => {
    const found = directory.sections.find((item) => item.id === ui.sectionSettingsId);
    return found === undefined ? null : { id: found.id, name: found.name };
  }, [directory.sections, ui.sectionSettingsId]);

  return (
    <SectionSettings
      open={ui.modal === "section"}
      onClose={ui.closeModal}
      section={section}
      supported={admin.supported.sections}
      permissionsSupported={admin.supported.roles}
      roles={roles}
      permissionOverrides={overrides}
      onSave={async (patch) => {
        if (sectionId !== null) await admin.updateSection(sectionId, patch);
      }}
      onSavePermissionOverride={save}
      onDelete={async () => {
        if (sectionId === null) return;
        setDeleteBlocked(false);
        try {
          await admin.deleteSection(sectionId);
          ui.closeModal();
        } catch (cause) {
          // The server refuses while channels still sit under the section.
          if (cause instanceof ApiError && cause.status === 409) {
            setDeleteBlocked(true);
            return;
          }
          throw cause;
        }
      }}
      deleteBlocked={deleteBlocked}
      onOpenRoles={() => ui.openModal("settings")}
    />
  );
}

/** "Add section" in the rail. */
export function SectionCreateDialog() {
  const { admin } = usePorts();
  const ui = useUi();
  const { t } = useLanguage();

  return (
    <SectionCreate
      open={ui.modal === "section-new"}
      onClose={ui.closeModal}
      onCreate={async (input) => {
        try {
          await admin.createSection(input);
        } catch (cause) {
          throw new Error(describeError(cause, t("section.createFailed"), t));
        }
      }}
    />
  );
}
