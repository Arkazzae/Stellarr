"use client";

import { useCallback, useEffect, useState } from "react";

import type { PermissionOverridePatch } from "@/components/settings/PermissionOverrideEditor";
import type { PermissionOverride, PermissionTargetType } from "@/ports";
import { usePorts } from "@/state/hooks";

export interface PermissionOverrides {
  overrides: PermissionOverride[];
  save: (roleId: string, patch: PermissionOverridePatch) => Promise<void>;
}

/**
 * One channel's or section's role overrides, fetched for the target a settings
 * dialog is open on rather than with the server-wide lists: most sessions never
 * open either dialog. A null `targetId` means no dialog is open.
 */
export function usePermissionOverrides(
  targetType: PermissionTargetType,
  targetId: string | null,
): PermissionOverrides {
  const { admin } = usePorts();
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);

  // Cleared while rendering so switching targets, or closing the dialog, never
  // shows the previous target's overrides for a frame.
  const [seed, setSeed] = useState(targetId);
  if (seed !== targetId) {
    setSeed(targetId);
    setOverrides([]);
  }

  useEffect(() => {
    if (targetId === null) return;
    let active = true;
    admin.listPermissionOverrides(targetType, targetId).then(
      (list) => {
        if (active) setOverrides(list);
      },
      () => {
        if (active) setOverrides([]);
      },
    );
    return () => {
      active = false;
    };
  }, [admin, targetType, targetId]);

  const save = useCallback(
    async (roleId: string, patch: PermissionOverridePatch) => {
      if (targetId === null) return;
      const saved = await admin.setPermissionOverride(targetType, targetId, roleId, patch);
      // An override that allows and denies nothing is the same as none.
      const kept = saved.allow.length === 0 && saved.deny.length === 0 ? [] : [saved];
      setOverrides((current) => [...current.filter((item) => item.roleId !== roleId), ...kept]);
    },
    [admin, targetType, targetId],
  );

  return { overrides, save };
}
