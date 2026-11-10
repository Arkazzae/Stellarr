"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { ComposerChip } from "@/components/room/ComposerChips";
import { toParts } from "@/components/room/parts";
import type { TranscriptSectionVM } from "@/components/room/Transcript";
import { buildTranscript, initials } from "@/lib/format";
import type {
  AddFriendResult,
  Attachment,
  DmConversation,
  Friend,
  FriendRequest,
  FriendsPort,
  Message,
  User,
} from "@/ports";

import { useEmoji } from "./EmojiProvider";
import { useLanguage } from "./LanguageProvider";
import { usePorts } from "./PortsProvider";
import { useSessionContext } from "./SessionProvider";
import { useUiContext } from "./UiProvider";
import { useVoiceContext } from "./VoiceProvider";

export interface FriendsValue {
  /** False when the connected server has no social endpoints. */
  supported: boolean;

  friends: Friend[];
  requests: FriendRequest[];
  blocked: User[];
  conversations: DmConversation[];

  /** Incoming requests only: what the pending badge counts. */
  incoming: number;
  /** Unread messages across every conversation. */
  unread: number;

  /** The open conversation, or null while the Friends view is showing. */
  active: DmConversation | null;
  /** The open conversation's transcript, grouped the way the room renders it. */
  sections: TranscriptSectionVM[];

  /**
   * Opens the conversation with this person, creating it if there is none, and
   * goes there. `text` is sent on the way in, so the mini profile's field can
   * write the first message and navigate in one action.
   */
  messagePerson: (userId: string, text?: string) => void;
  /** Opens a conversation if necessary and starts its private call. */
  callPerson: (userId: string) => void;
  /** Starts or joins the call attached to an existing conversation. */
  callConversation: (conversationId: string) => void;
  declineCall: (conversationId: string) => void;
  /** Sends into the open conversation. No-op when there is none. */
  send: (text: string) => Promise<void>;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  loadOlderMessages: () => void;
  chips: ComposerChip[];
  attach: (files: File[]) => void;
  retryChip: (chipId: string) => void;
  removeChip: (chipId: string) => void;
  reorderChips: (from: number, to: number) => void;

  addFriend: (username: string) => Promise<AddFriendResult>;
  accept: (requestId: string) => void;
  decline: (requestId: string) => void;
  cancel: (requestId: string) => void;
  remove: (userId: string) => void;
  block: (userId: string) => void;
  unblock: (userId: string) => void;
}

const FriendsContext = createContext<FriendsValue | null>(null);

const NO_MESSAGES: Message[] = [];
const NO_SECTIONS: TranscriptSectionVM[] = [];
const MAX_ATTACHMENTS = 10;

interface PendingChip extends ComposerChip {
  file: File;
  attachment: Attachment | null;
}

/** Reads a value the port owns. The port hands back a stable reference until it changes. */
function useSocial<T>(port: FriendsPort, read: () => T): T {
  return useSyncExternalStore(port.onChanged, read, read);
}

/** The attachments waiting to go out with the next message. */
function useAttachments(port: FriendsPort) {
  const { t } = useLanguage();
  const [chips, setChips] = useState<PendingChip[]>([]);

  const patch = useCallback((id: string, change: Partial<PendingChip>) => {
    setChips((current) =>
      current.map((chip) => (chip.id === id ? { ...chip, ...change } : chip)),
    );
  }, []);

  const upload = useCallback(
    (chip: PendingChip) => {
      patch(chip.id, { status: "uploading", error: undefined });
      void port.uploadAttachment(chip.file).then(
        (attachment) =>
          patch(chip.id, { status: "ready", attachment, error: undefined }),
        () => patch(chip.id, { status: "error", error: t("attachment.uploadFailed") }),
      );
    },
    [port, patch, t],
  );

  const attach = useCallback(
    (files: File[]) => {
      for (const file of files.slice(0, Math.max(0, MAX_ATTACHMENTS - chips.length))) {
        const chip: PendingChip = {
          id: `dm-chip-${crypto.randomUUID()}`,
          name: file.name,
          status: "uploading",
          file,
          attachment: null,
        };
        setChips((current) => [...current, chip]);
        upload(chip);
      }
    },
    [chips.length, upload],
  );

  const retry = useCallback(
    (chipId: string) => {
      const chip = chips.find((item) => item.id === chipId);
      if (chip !== undefined) upload(chip);
    },
    [chips, upload],
  );

  const remove = useCallback((chipId: string) => {
    setChips((current) => current.filter((chip) => chip.id !== chipId));
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setChips((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return current;
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const discard = useCallback((ids: ReadonlySet<string>) => {
    setChips((current) => current.filter((chip) => !ids.has(chip.id)));
  }, []);

  const view = useMemo<ComposerChip[]>(
    () =>
      chips.map(({ id, name, status, error }) => ({
        id,
        name,
        status,
        ...(error === undefined ? {} : { error }),
      })),
    [chips],
  );

  return { chips, view, attach, retry, remove, reorder, discard };
}

/**
 * The friends graph and the private conversations.
 *
 * A provider of its own rather than a branch of `ChatProvider`: that one
 * follows the active channel and talks to `ports.chat`, and a conversation is
 * neither. What they share is how a transcript is built, and that is a function
 * (`buildTranscript` and `toParts`), called here rather than inherited.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { locale } = useLanguage();
  const { friends: port } = usePorts();
  const { byShortcode: customEmoji } = useEmoji();
  const { user } = useSessionContext();
  const { activeDmId, openDm } = useUiContext();
  const {
    join: joinVoice,
    leave: leaveVoice,
    privateCall,
    channelId: voiceRoomId,
  } = useVoiceContext();

  const {
    chips,
    view: chipViews,
    attach,
    retry: retryChip,
    remove: removeChip,
    reorder: reorderChips,
    discard: discardChips,
  } = useAttachments(port);
  const failedSend = useRef<{ fingerprint: string; clientMessageId: string } | null>(
    null,
  );

  const friends = useSocial(port, port.listFriends);
  const requests = useSocial(port, port.listRequests);
  const blocked = useSocial(port, port.listBlocked);
  const conversations = useSocial(port, port.listConversations);
  // Paging and the transcript change without touching the lists above, so the
  // open conversation's own state is read from the port as well.
  const messages = useSocial(port, () =>
    activeDmId === null ? NO_MESSAGES : port.listDmMessages(activeDmId),
  );
  const hasOlderMessages = useSocial(
    port,
    () => activeDmId !== null && port.hasOlderDmMessages(activeDmId),
  );
  const loadingOlderMessages = useSocial(
    port,
    () => activeDmId !== null && port.isLoadingOlderDmMessages(activeDmId),
  );

  const active =
    conversations.find((conversation) => conversation.id === activeDmId) ?? null;

  // Opening a conversation is what reads it, so one reached any other way (a
  // reload, a message arriving while it is open) is not left unread. The port
  // reports each newest message once, so the refresh a read causes is not read
  // again.
  const activeUnread = active?.unread ?? 0;
  const activeNewest = active?.lastMessage?.id ?? null;
  useEffect(() => {
    if (activeDmId !== null) port.markRead(activeDmId);
  }, [port, activeDmId, activeUnread, activeNewest]);

  // Blocking either person removes the conversation from the snapshot, but a
  // browser-to-browser connection would outlive that decision, so the private
  // call is closed as soon as its conversation disappears.
  useEffect(() => {
    if (!privateCall || voiceRoomId === null) return;
    if (conversations.some((item) => item.id === voiceRoomId)) return;
    void leaveVoice();
  }, [conversations, privateCall, voiceRoomId, leaveVoice]);

  const sections = useMemo<TranscriptSectionVM[]>(() => {
    if (activeDmId === null) return NO_SECTIONS;
    // Both authors are already `User`s, so no directory lookup is needed.
    const avatars = new Map<string, string>();
    for (const person of [user, active?.peer]) {
      if (person?.avatarUrl !== undefined) avatars.set(person.id, person.avatarUrl);
    }
    return buildTranscript(messages, new Date(), locale).map((section) => ({
      day: section.day,
      groups: section.groups.map((group) => {
        const avatarUrl = avatars.get(group.authorId);
        return {
          id: group.key,
          authorId: group.authorId,
          authorName: group.authorName,
          ...(group.authorId === user?.id ? { own: true } : {}),
          ...(avatarUrl === undefined ? {} : { authorAvatarUrl: avatarUrl }),
          timestamp: group.startedAt,
          bodies: group.messages.map((message) => ({
            id: message.id,
            parts: toParts(message, { emoji: customEmoji }),
          })),
        };
      }),
    }));
  }, [activeDmId, messages, user, active, customEmoji, locale]);

  const messagePerson = useCallback(
    (userId: string, text?: string) => {
      void (async () => {
        const id = await port.openConversation(userId);
        // Sent against the id rather than through `send`, which follows the
        // open conversation, and that is still the previous one until the
        // navigation below has rendered.
        const content = text?.trim() ?? "";
        if (content.length > 0) {
          await port.sendDm(id, {
            content,
            attachmentIds: [],
            clientMessageId: crypto.randomUUID(),
          });
        }
        openDm(id);
      })().catch(() => undefined);
    },
    [port, openDm],
  );

  const send = useCallback(
    async (text: string) => {
      if (activeDmId === null) return;
      if (chips.some((chip) => chip.status !== "ready")) {
        throw new Error("Attachments are still uploading or need a retry.");
      }
      const attachmentIds = chips.flatMap((chip) =>
        chip.attachment === null ? [] : [chip.attachment.id],
      );
      if (text.trim().length === 0 && attachmentIds.length === 0) return;

      // A retry of the same message keeps its id, so the server can tell it
      // from a second message if the first attempt did arrive.
      const fingerprint = JSON.stringify([activeDmId, text, attachmentIds]);
      const previous = failedSend.current;
      const clientMessageId =
        previous?.fingerprint === fingerprint
          ? previous.clientMessageId
          : crypto.randomUUID();
      try {
        await port.sendDm(activeDmId, { content: text, attachmentIds, clientMessageId });
      } catch (cause) {
        failedSend.current = { fingerprint, clientMessageId };
        throw cause;
      }
      if (failedSend.current?.clientMessageId === clientMessageId) {
        failedSend.current = null;
      }
      discardChips(new Set(chips.map((chip) => chip.id)));
    },
    [port, activeDmId, chips, discardChips],
  );

  const joinConversationCall = useCallback(
    (id: string, peer: User | undefined) => {
      joinVoice(id, {
        label: peer === undefined ? "Rozmowa prywatna" : `Rozmowa z ${peer.displayName}`,
        privateCall: true,
        ...(peer === undefined
          ? {}
          : {
              people: [
                {
                  id: peer.id,
                  displayName: peer.displayName,
                  initials: initials(peer.displayName),
                  presence: peer.presence,
                  ...(peer.avatarUrl === undefined ? {} : { avatarUrl: peer.avatarUrl }),
                },
              ],
            }),
      });
      openDm(id);
    },
    [joinVoice, openDm],
  );

  const callConversation = useCallback(
    (conversationId: string) => {
      const conversation = conversations.find((item) => item.id === conversationId);
      if (conversation !== undefined) {
        joinConversationCall(conversation.id, conversation.peer);
      }
    },
    [conversations, joinConversationCall],
  );

  const callPerson = useCallback(
    (personId: string) => {
      const known =
        conversations.find((item) => item.peer.id === personId)?.peer ??
        friends.find((item) => item.user.id === personId)?.user;
      void port
        .openConversation(personId)
        .then((id) => joinConversationCall(id, known))
        .catch(() => undefined);
    },
    [port, conversations, friends, joinConversationCall],
  );

  const loadOlderMessages = useCallback(() => {
    if (activeDmId !== null) {
      void port.loadOlderDmMessages(activeDmId).catch(() => undefined);
    }
  }, [port, activeDmId]);

  const addFriend = useCallback(
    async (username: string) => {
      // Answered locally, so the form needs no round trip to refuse yourself.
      const wanted = username.trim().replace(/^@/, "").toLowerCase();
      if (user !== null && wanted === user.username.toLowerCase()) return "self";
      return port.addFriend(username);
    },
    [port, user],
  );

  // Failures leave the lists as they were; the next snapshot corrects the view.
  const commands = useMemo(() => {
    const quietly = (pending: Promise<unknown>) => {
      void pending.catch(() => undefined);
    };
    return {
      declineCall: (conversationId: string) => quietly(port.declineCall(conversationId)),
      accept: (requestId: string) => quietly(port.acceptRequest(requestId)),
      decline: (requestId: string) => quietly(port.declineRequest(requestId)),
      cancel: (requestId: string) => quietly(port.cancelRequest(requestId)),
      remove: (userId: string) => quietly(port.removeFriend(userId)),
      block: (userId: string) => quietly(port.block(userId)),
      unblock: (userId: string) => quietly(port.unblock(userId)),
    };
  }, [port]);

  const value = useMemo<FriendsValue>(
    () => ({
      supported: port.supported,
      friends,
      requests,
      blocked,
      conversations,
      incoming: requests.filter((request) => request.direction === "incoming").length,
      unread: conversations.reduce((total, item) => total + item.unread, 0),
      active,
      sections,
      messagePerson,
      callPerson,
      callConversation,
      send,
      hasOlderMessages,
      loadingOlderMessages,
      loadOlderMessages,
      chips: chipViews,
      attach,
      retryChip,
      removeChip,
      reorderChips,
      addFriend,
      ...commands,
    }),
    [
      port,
      friends,
      requests,
      blocked,
      conversations,
      active,
      sections,
      messagePerson,
      callPerson,
      callConversation,
      send,
      hasOlderMessages,
      loadingOlderMessages,
      loadOlderMessages,
      chipViews,
      attach,
      retryChip,
      removeChip,
      reorderChips,
      addFriend,
      commands,
    ],
  );

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriendsContext(): FriendsValue {
  const value = useContext(FriendsContext);
  if (value === null) {
    throw new Error("useFriends must be used inside <FriendsProvider>");
  }
  return value;
}
