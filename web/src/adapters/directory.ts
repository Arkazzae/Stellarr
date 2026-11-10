import { ACTIVE_SERVER_STORAGE_KEY } from "@/lib/api/client";
import type { Server } from "@/lib/api/types";
import type { DirectoryPort } from "@/ports";

import type { DirectoryStore } from "./store";

/** Shown until the bootstrap snapshot arrives. */
const UNKNOWN_SERVER: Server = { id: "", name: "Stellarr" };

type PersistOrder = (orderedIds: string[]) => Promise<void>;

/**
 * `DirectoryPort` over the shared directory store.
 *
 * Reordering is optimistic: the store changes at once so a drag does not snap
 * back, and the previous order returns if the server refuses.
 */
export function createDirectoryAdapter(
  store: DirectoryStore,
  persistOrder?: PersistOrder,
  persistSectionOrder?: PersistOrder,
  serverActions?: {
    create: DirectoryPort["createServer"];
    discover: DirectoryPort["discoverServers"];
    join: DirectoryPort["joinServer"];
    joinInvite: DirectoryPort["joinInvite"];
  },
): DirectoryPort {
  return {
    getServer: () => store.getSnapshot().server ?? UNKNOWN_SERVER,
    listServers: () => store.getSnapshot().servers,
    listChannels: () => store.getSnapshot().channels,
    listSections: () => store.getSnapshot().sections,
    listPermissions: () => store.getSnapshot().permissions,
    onChanged: (handler) => store.subscribe(handler),

    reorderChannels: (orderedIds) =>
      reorder(
        orderedIds,
        store.getSnapshot().channels.map((channel) => channel.id),
        (ids) => store.setChannelOrder(ids),
        persistOrder,
      ),

    reorderSections: (orderedIds) =>
      reorder(
        orderedIds,
        store.getSnapshot().sections.map((section) => section.id),
        (ids) => store.setSectionOrder(ids),
        persistSectionOrder,
      ),

    async createServer(input) {
      if (serverActions === undefined) throw new Error("Server creation is unavailable.");
      return serverActions.create(input);
    },

    async discoverServers() {
      return serverActions?.discover() ?? [];
    },

    async joinServer(serverId) {
      if (serverActions === undefined) throw new Error("Joining servers is unavailable.");
      return serverActions.join(serverId);
    },

    async joinInvite(code) {
      if (serverActions === undefined) throw new Error("Joining by invite is unavailable.");
      return serverActions.joinInvite(code);
    },

    selectServer(serverId) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, serverId);
    },
  };
}

async function reorder(
  orderedIds: string[],
  previousIds: string[],
  apply: (ids: string[]) => void,
  persist: PersistOrder | undefined,
): Promise<void> {
  apply(orderedIds);
  if (persist === undefined) return;
  try {
    await persist(orderedIds);
  } catch (error) {
    apply(previousIds);
    throw error;
  }
}
