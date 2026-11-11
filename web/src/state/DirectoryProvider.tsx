"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { NewServer, Server, VoiceOccupant } from "@/ports";

import {
  deriveDirectoryView,
  deriveTextChannels,
  sameOccupancy,
  spliceGroupOrder,
  type DirectorySnapshot,
  type DirectoryView,
} from "./directoryView";
import { usePorts } from "./PortsProvider";

export interface DirectoryValue extends DirectoryView {
  /**
   * Reorders channels within one rail group, a section or the unsectioned
   * bucket, and leaves every other channel where it was. `newGroupOrder` is the
   * complete, freshly ordered id list of that one group.
   */
  reorderChannelGroup: (newGroupOrder: string[]) => Promise<void>;
  createServer: (input: NewServer) => Promise<Server>;
  discoverServers: () => Promise<Server[]>;
  joinServer: (serverId: string) => Promise<Server>;
  joinInvite: (code: string) => Promise<Server>;
  selectServer: (serverId: string) => void;
}

const DirectoryContext = createContext<DirectoryValue | null>(null);

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const { directory, presence } = usePorts();

  // Presence and occupancy reach the shared store only through these
  // subscriptions, because the adapter writes inside the handler. Without a
  // subscriber the hub's events would be parsed and dropped, so the app holds
  // one for the whole session and ignores the payload.
  useEffect(() => {
    const unsubscribes = [
      presence.onPresenceChanged(() => undefined),
      presence.onOccupantsChanged(() => undefined),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [presence]);

  const lastSnapshot = useRef<DirectorySnapshot | null>(null);

  // `useSyncExternalStore` needs the same object back while nothing changed,
  // and the ports build a new occupancy map on every read.
  const getSnapshot = useCallback((): DirectorySnapshot => {
    const channels = directory.listChannels();
    const occupancy = new Map<string, VoiceOccupant[]>();
    for (const channel of channels) {
      if (channel.kind === "voice") occupancy.set(channel.id, presence.occupantsOf(channel.id));
    }
    const read: DirectorySnapshot = {
      server: directory.getServer(),
      servers: directory.listServers(),
      channels,
      sections: directory.listSections(),
      members: presence.listMembers(),
      permissions: directory.listPermissions(),
      occupancy,
    };

    const previous = lastSnapshot.current;
    const unchanged =
      previous !== null &&
      previous.server === read.server &&
      previous.servers === read.servers &&
      previous.channels === read.channels &&
      previous.sections === read.sections &&
      previous.members === read.members &&
      previous.permissions === read.permissions &&
      sameOccupancy(previous.occupancy, read.occupancy);
    if (unchanged) return previous;
    lastSnapshot.current = read;
    return read;
  }, [directory, presence]);

  // The stores are empty until the bootstrap hydrates them, which is also what
  // the server render sees, so one getter serves both.
  const snapshot = useSyncExternalStore(directory.onChanged, getSnapshot, getSnapshot);

  // Occupancy and presence move far more often than channels, and the store
  // keeps the channel list while they do. Text channels derived from that list
  // alone keep their identity through a call, so nothing keyed on them, such as
  // the rail's rows, is rebuilt for someone joining or muting.
  const textChannels = useMemo(
    () => deriveTextChannels(snapshot.channels),
    [snapshot.channels],
  );

  const value = useMemo<DirectoryValue>(
    () => ({
      ...deriveDirectoryView(snapshot, textChannels),
      reorderChannelGroup: (newGroupOrder) =>
        directory.reorderChannels(spliceGroupOrder(snapshot.channels, newGroupOrder)),
      createServer: directory.createServer,
      discoverServers: directory.discoverServers,
      joinServer: directory.joinServer,
      joinInvite: directory.joinInvite,
      selectServer: directory.selectServer,
    }),
    [snapshot, textChannels, directory],
  );

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

export function useDirectoryContext(): DirectoryValue {
  const value = useContext(DirectoryContext);
  if (value === null) {
    throw new Error("useDirectory must be used inside <DirectoryProvider>");
  }
  return value;
}
