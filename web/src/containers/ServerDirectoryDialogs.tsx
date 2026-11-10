"use client";

import { useCallback } from "react";

import { ClientDownloadModal } from "@/components/settings/ClientDownloadModal";
import {
  ServerCreateModal,
  ServerDiscoverModal,
  type ServerCreateInput,
} from "@/components/settings/ServerDirectoryModals";
import { getClientReleases } from "@/lib/desktopRelease";
import { ApiError, describeError } from "@/lib/api/errors";
import { useDirectory, useLanguage, useSession, useUi } from "@/state/hooks";

/** The code at the end of an invite link, or the code itself when that is all that was pasted. */
function inviteCodeOf(value: string): string {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).pathname.split("/").filter(Boolean).at(-1) ?? trimmed;
  } catch {
    const path = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
    return path.split("/").filter(Boolean).at(-1) ?? trimmed;
  }
}

/** Creating a server, finding or joining one, and picking a client to install. */
export function ServerDirectoryDialogs() {
  const directory = useDirectory();
  const session = useSession();
  const ui = useUi();
  const { t } = useLanguage();

  // Joining a server reloads the session, so the person lands in it with its
  // channels and members rather than the one they left.
  const activateServer = useCallback(
    (serverId: string) => {
      directory.selectServer(serverId);
      ui.openServer();
      session.reload();
    },
    [directory, session, ui],
  );

  const createServer = useCallback(
    async (input: ServerCreateInput) => {
      try {
        activateServer((await directory.createServer(input)).id);
      } catch (cause) {
        throw new Error(describeError(cause, t("shell.serverCreateFailed"), t));
      }
    },
    [activateServer, directory, t],
  );

  const loadPublicServers = useCallback(async () => {
    try {
      return await directory.discoverServers();
    } catch (cause) {
      throw new Error(describeError(cause, t("shell.serverDiscoveryFailed"), t));
    }
  }, [directory, t]);

  const joinPublicServer = useCallback(
    async (serverId: string) => {
      try {
        activateServer((await directory.joinServer(serverId)).id);
      } catch (cause) {
        throw new Error(describeError(cause, t("shell.serverJoinFailed"), t));
      }
    },
    [activateServer, directory, t],
  );

  const joinInvitedServer = useCallback(
    async (invite: string) => {
      try {
        activateServer((await directory.joinInvite(inviteCodeOf(invite))).id);
      } catch (cause) {
        throw new Error(
          cause instanceof ApiError && cause.status === 404
            ? t("shell.inviteInvalidDetail")
            : describeError(cause, t("shell.serverJoinFailed"), t),
        );
      }
    },
    [activateServer, directory, t],
  );

  return (
    <>
      <ClientDownloadModal
        open={ui.modal === "client"}
        onClose={ui.closeModal}
        loadReleases={getClientReleases}
      />
      <ServerCreateModal
        open={ui.modal === "server-create"}
        onClose={ui.closeModal}
        onCreate={createServer}
      />
      <ServerDiscoverModal
        open={ui.modal === "server-discover"}
        onClose={ui.closeModal}
        loadServers={loadPublicServers}
        onJoinServer={joinPublicServer}
        onJoinInvite={joinInvitedServer}
      />
    </>
  );
}
