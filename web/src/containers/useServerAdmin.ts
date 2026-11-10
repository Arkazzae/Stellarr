"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  AdminMember,
  AuditEntry,
  Ban,
  Invite,
  Role,
  ServerAdminPort,
} from "@/ports";
import { usePorts } from "@/state/hooks";

/** The server-wide lists the management dialogs read. */
export interface AdminData {
  roles: Role[];
  members: AdminMember[];
  invites: Invite[];
  bans: Ban[];
  audit: AuditEntry[];
}

const EMPTY_ADMIN: AdminData = {
  roles: [],
  members: [],
  invites: [],
  bans: [],
  audit: [],
};

/**
 * Reads every list the server can serve and leaves the rest empty. The member
 * and server panes show role chips, so they need the roles too.
 */
async function fetchAdmin(admin: ServerAdminPort): Promise<AdminData> {
  const { supported } = admin;
  const [roles, members, invites, bans, audit] = await Promise.all([
    supported.roles || supported.members || supported.server ? admin.listRoles() : [],
    supported.members || supported.server ? admin.listMembers() : [],
    supported.invites ? admin.listInvites() : [],
    supported.bans ? admin.listBans() : [],
    supported.audit ? admin.listAuditEntries() : [],
  ]);
  return { roles, members, invites, bans, audit };
}

export interface ServerAdmin {
  data: AdminData;
  /**
   * Refetches the lists once a mutation has landed. It does not wait for them,
   * so a pane's pending state ends with its mutation, and a failed refetch
   * leaves the lists as they were.
   */
  reload: () => void;
}

/**
 * The admin lists, fetched when a dialog that shows any of them opens rather
 * than at boot: they back panes most sessions never look at.
 */
export function useServerAdmin(wanted: boolean): ServerAdmin {
  const { admin } = usePorts();
  const [data, setData] = useState<AdminData>(EMPTY_ADMIN);

  useEffect(() => {
    if (!wanted) return;
    let active = true;
    fetchAdmin(admin).then(
      (next) => {
        // A dialog closed while the requests were in flight must not have its
        // lists overwritten on the way out.
        if (active) setData(next);
      },
      () => {
        // A list the server cannot serve stays empty; the support flags keep
        // its pane from writing.
      },
    );
    return () => {
      active = false;
    };
  }, [wanted, admin]);

  const reload = useCallback(() => {
    fetchAdmin(admin).then(setData, () => {
      // The lists keep what they last held.
    });
  }, [admin]);

  return { data, reload };
}
