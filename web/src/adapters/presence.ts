import type { RealtimeClient } from "@/lib/realtime/types";
import type { ConnectionPort, PresencePort } from "@/ports";

import type { DirectoryStore } from "./store";

/**
 * Presence reads the shared directory store and the hub writes to it.
 *
 * The write happens here rather than in a React provider, so presence keeps
 * updating between renders and a component that mounts late reads the current
 * state instead of waiting for the next event.
 */
export function createPresenceAdapter(
  store: DirectoryStore,
  realtime: RealtimeClient,
): PresencePort {
  return {
    listMembers: () => store.getSnapshot().members,

    presenceOf: (userId) =>
      store.getSnapshot().members.find((member) => member.id === userId)?.presence ?? "offline",

    setPresence: (presence) => realtime.setPresence(presence),

    onPresenceChanged: (handler) =>
      realtime.on("PresenceChanged", ({ userId, presence }) => {
        store.setPresence(userId, presence);
        handler(userId, presence);
      }),

    occupantsOf: (channelId) => store.getSnapshot().occupancy[channelId] ?? [],

    onOccupantsChanged: (handler) =>
      realtime.on("VoiceParticipantChanged", ({ channelId, participants }) => {
        store.setOccupants(channelId, participants);
        handler(channelId, participants);
      }),
  };
}

export function createConnectionAdapter(realtime: RealtimeClient): ConnectionPort {
  return {
    getStatus: () => realtime.getStatus(),
    subscribe: (listener) => realtime.subscribeStatus(listener),
  };
}
