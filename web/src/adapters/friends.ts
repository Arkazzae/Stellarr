import type { SocialApiClient } from "@/lib/api/client";
import type { VoiceOccupant } from "@/lib/api/types";
import { probeMedia } from "@/lib/media/probe";
import type { RealtimeClient } from "@/lib/realtime/types";
import type {
  DmConversation,
  DmId,
  Friend,
  FriendRequest,
  FriendsPort,
  Message,
  User,
} from "@/ports";

const NO_MESSAGES: Message[] = [];
const PAGE_SIZE = 50;

interface DirectCall {
  /** Stable while the call lasts, through mute and speaking updates. */
  id: string;
  participants: readonly VoiceOccupant[];
}

function mergeMessages(
  current: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

/** Persisted friends and direct messages over HTTP, kept fresh through SignalR. */
export function createFriendsAdapter(
  api: SocialApiClient,
  realtime: RealtimeClient,
): FriendsPort {
  const listeners = new Set<() => void>();
  const transcripts = new Map<DmId, Message[]>();
  /** Where the next older page starts; null once the transcript is complete. */
  const olderCursors = new Map<DmId, string | null>();
  const olderLoads = new Map<DmId, Promise<void>>();
  /** Per conversation, the newest message already reported as read. */
  const reportedRead = new Map<DmId, string>();
  const calls = new Map<DmId, DirectCall>();
  let callCount = 0;

  let friends: Friend[] = [];
  let requests: FriendRequest[] = [];
  let blocked: User[] = [];
  let conversations: DmConversation[] = [];

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const withCalls = (items: readonly DmConversation[]): DmConversation[] =>
    items.map(({ callParticipants: _participants, callId: _id, ...conversation }) => {
      const call = calls.get(conversation.id);
      return call === undefined
        ? conversation
        : { ...conversation, callParticipants: call.participants, callId: call.id };
    });

  let inflight: Promise<void> | null = null;
  let reloadAfter = false;

  /** Concurrent callers share one request; a request made meanwhile reruns it. */
  const load = (): Promise<void> => {
    if (inflight !== null) {
      reloadAfter = true;
      return inflight;
    }
    inflight = (async () => {
      const state = await api.getSocialState();
      friends = state.friends;
      requests = state.requests;
      blocked = state.blocked;
      conversations = withCalls(state.conversations);
      emit();
    })().finally(() => {
      inflight = null;
      if (reloadAfter) {
        reloadAfter = false;
        void load().catch(() => undefined);
      }
    });
    return inflight;
  };

  const loadNewest = async (id: DmId, replace: boolean): Promise<void> => {
    const page = await api.listDirectMessages(id, { limit: PAGE_SIZE });
    const loaded = transcripts.get(id) ?? NO_MESSAGES;
    transcripts.set(id, replace ? page.messages : mergeMessages(loaded, page.messages));
    // A reconnect starts a new server-side snapshot. The messages already on
    // screen stay, but paging continues from the fresh cursor: keeping the old
    // one could skip a page that arrived while the connection was down.
    olderCursors.set(id, page.nextCursor);
    emit();
  };

  const loadOlder = (id: DmId): Promise<void> => {
    const running = olderLoads.get(id);
    if (running !== undefined) return running;
    const cursor = olderCursors.get(id);
    if (cursor === undefined || cursor === null) return Promise.resolve();

    const operation = api
      .listDirectMessages(id, { cursor, limit: PAGE_SIZE })
      .then((page) => {
        transcripts.set(id, mergeMessages(page.messages, transcripts.get(id) ?? NO_MESSAGES));
        olderCursors.set(id, page.nextCursor);
      })
      .finally(() => {
        olderLoads.delete(id);
        emit();
      });
    olderLoads.set(id, operation);
    emit();
    return operation;
  };

  const changeThenReload = async (change: () => Promise<void>): Promise<void> => {
    await change();
    await load();
  };

  let lastStatus = realtime.getStatus();

  const unsubscribers = [
    realtime.on("SocialChanged", () => {
      void load().catch(() => undefined);
    }),

    realtime.on("DirectMessageCreated", (message) => {
      const id = message.channelId;
      const transcript = transcripts.get(id);
      if (transcript !== undefined && !transcript.some((item) => item.id === message.id)) {
        transcripts.set(id, [...transcript, message]);
      }
      conversations = conversations.map((conversation) =>
        conversation.id !== id
          ? conversation
          : {
              ...conversation,
              lastMessage: message,
              updatedAt: message.createdAt,
              unread:
                message.author.id === conversation.peer.id
                  ? conversation.unread + 1
                  : conversation.unread,
            },
      );
      emit();
    }),

    realtime.on("VoiceParticipantChanged", (event) => {
      // Public channels share this event. Remembering their occupancy costs
      // little and closes a race for a brand-new DM, whose call can be
      // announced before the SocialChanged that introduces the conversation.
      // `withCalls` only shows entries whose ids turn out to be DMs.
      if (event.participants.length === 0) {
        calls.delete(event.channelId);
      } else {
        const id = calls.get(event.channelId)?.id ?? `${event.channelId}:${++callCount}`;
        calls.set(event.channelId, { id, participants: event.participants });
      }
      conversations = withCalls(conversations);
      emit();
    }),

    realtime.subscribeStatus(() => {
      const status = realtime.getStatus();
      const reconnected = status === "connected" && lastStatus !== "connected";
      lastStatus = status;
      if (!reconnected) return;
      // SignalR events are not replayed, so a reconnect refreshes the summaries
      // and every thread that was opened: a message sent during the outage must
      // not leave a transcript behind for good.
      void Promise.all([
        load(),
        ...[...transcripts.keys()].map((id) => loadNewest(id, false)),
      ]).catch(() => undefined);
    }),
  ];

  return {
    supported: true,
    load,
    listFriends: () => friends,
    listRequests: () => requests,
    listBlocked: () => blocked,
    listConversations: () => conversations,
    listDmMessages: (id) => transcripts.get(id) ?? NO_MESSAGES,
    hasOlderDmMessages: (id) => olderCursors.get(id) != null,
    isLoadingOlderDmMessages: (id) => olderLoads.has(id),
    loadOlderDmMessages: loadOlder,

    async openConversation(userId) {
      const id = await api.openDirectConversation(userId);
      await Promise.all([load(), loadNewest(id, true)]);
      return id;
    },

    async sendDm(id, input) {
      const message = await api.sendDirectMessage(
        id,
        input.content,
        input.attachmentIds,
        input.clientMessageId,
      );
      const transcript = transcripts.get(id) ?? NO_MESSAGES;
      if (!transcript.some((item) => item.id === message.id)) {
        transcripts.set(id, [...transcript, message]);
        emit();
      }
      await load();
      return message;
    },

    async uploadAttachment(file) {
      return api.uploadAttachment(file, await probeMedia(file));
    },

    markRead(id) {
      const conversation = conversations.find((item) => item.id === id);
      // The server answers a read with SocialChanged, and the refresh that
      // follows would report the same read again, for as long as the thread
      // stays open. So a read is reported once per newest message.
      const newest = conversation?.lastMessage?.id ?? conversation?.updatedAt ?? "";
      const unread = conversation?.unread ?? 0;
      if (conversation !== undefined && unread === 0 && reportedRead.get(id) === newest) {
        return;
      }
      reportedRead.set(id, newest);
      if (unread > 0) {
        conversations = conversations.map((item) =>
          item.id === id ? { ...item, unread: 0 } : item,
        );
        emit();
      }
      void api.markDirectConversationRead(id).catch(() => {
        reportedRead.delete(id);
        void load().catch(() => undefined);
      });
    },

    declineCall: (id) => realtime.declineDirectCall(id),

    async addFriend(username) {
      const answer = await api.sendFriendRequest(username);
      await load();
      return answer;
    },
    acceptRequest: (id) => changeThenReload(() => api.acceptFriendRequest(id)),
    declineRequest: (id) => changeThenReload(() => api.deleteFriendRequest(id)),
    cancelRequest: (id) => changeThenReload(() => api.deleteFriendRequest(id)),
    removeFriend: (userId) => changeThenReload(() => api.removeFriend(userId)),
    block: (userId) => changeThenReload(() => api.blockUser(userId)),
    unblock: (userId) => changeThenReload(() => api.unblockUser(userId)),

    onChanged(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      listeners.clear();
      transcripts.clear();
      olderCursors.clear();
      olderLoads.clear();
      calls.clear();
    },
  };
}
