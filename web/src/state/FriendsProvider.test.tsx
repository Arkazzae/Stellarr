import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFriendsAdapter } from "@/adapters/friends";
import type { SocialApiClient } from "@/lib/api/client";
import type { Attachment, Message, SocialState, User } from "@/lib/api/types";
import type {
  AddFriendResult,
  DmConversation,
  FriendRequest,
  FriendsPort,
} from "@/ports";
import { FakeRealtimeClient } from "@/test/fakes";

import { FriendsProvider, useFriendsContext } from "./FriendsProvider";
import { UiProvider, useUiContext } from "./UiProvider";

const harness = vi.hoisted(() => ({
  port: undefined as unknown as FriendsPort,
  user: {
    id: "u-maja",
    username: "maja",
    displayName: "Maja",
    presence: "online",
  } as User | null,
  emoji: { byShortcode: new Map<string, string>() },
  language: { locale: "pl", t: (key: string) => key },
  voice: undefined as unknown as {
    channelId: string | null;
    privateCall: boolean;
    join: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("./PortsProvider", () => ({ usePorts: () => ({ friends: harness.port }) }));
vi.mock("./SessionProvider", () => ({ useSessionContext: () => ({ user: harness.user }) }));
vi.mock("./EmojiProvider", () => ({ useEmoji: () => harness.emoji }));
vi.mock("./LanguageProvider", () => ({ useLanguage: () => harness.language }));
vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => ({ firstTextChannelId: null }),
}));
vi.mock("./VoiceProvider", () => ({ useVoiceContext: () => harness.voice }));

const ADA: User = { id: "u-ada", username: "ada", displayName: "Ada Lovelace", presence: "online" };
const BOB: User = { id: "u-bob", username: "bob", displayName: "Bob", presence: "idle" };
const ISO = "2026-01-01T00:00:00.000Z";

const CONVERSATION: DmConversation = { id: "dm-1", peer: ADA, unread: 0, updatedAt: ISO };
const CONVERSATIONS = [CONVERSATION];
const FRIENDS = [{ user: BOB, since: ISO }];
const NOTHING: never[] = [];

function directMessage(id: string, author: User, channelId: string, createdAt = ISO): Message {
  return {
    id,
    channelId,
    author: { id: author.id, displayName: author.displayName },
    content: `content of ${id}`,
    attachments: [],
    embeds: [],
    createdAt,
  };
}

function attachment(name: string): Attachment {
  return { id: `att-${name}`, url: `/files/${name}`, name, contentType: "text/plain", size: 3 };
}

function file(name: string): File {
  return new File(["abc"], name, { type: "text/plain" });
}

/** A port whose lists are stable and whose commands are spies. */
function stubPort(overrides: Partial<FriendsPort> = {}): FriendsPort {
  return {
    load: async () => {},
    listFriends: () => NOTHING,
    listRequests: () => NOTHING,
    listBlocked: () => NOTHING,
    listConversations: () => CONVERSATIONS,
    listDmMessages: () => NOTHING,
    hasOlderDmMessages: () => false,
    isLoadingOlderDmMessages: () => false,
    loadOlderDmMessages: vi.fn(async () => {}),
    openConversation: vi.fn(async () => CONVERSATION.id),
    sendDm: vi.fn(async (id) => directMessage("sent", ADA, id)),
    uploadAttachment: vi.fn(async (upload) => attachment(upload.name)),
    markRead: vi.fn(),
    declineCall: vi.fn(async () => {}),
    addFriend: vi.fn(async () => "sent" as const),
    acceptRequest: vi.fn(async () => {}),
    declineRequest: vi.fn(async () => {}),
    cancelRequest: vi.fn(async () => {}),
    removeFriend: vi.fn(async () => {}),
    block: vi.fn(async () => {}),
    unblock: vi.fn(async () => {}),
    onChanged: () => () => {},
    ...overrides,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <UiProvider>
      <FriendsProvider>{children}</FriendsProvider>
    </UiProvider>
  );
}

function mount() {
  return renderHook(
    () => ({ friends: useFriendsContext(), ui: useUiContext() }),
    { wrapper: Providers },
  );
}

type Mounted = ReturnType<typeof mount>;

const chipStatuses = (mounted: Mounted) =>
  mounted.result.current.friends.chips.map((chip) => chip.status);

beforeEach(() => {
  harness.user = { id: "u-maja", username: "maja", displayName: "Maja", presence: "online" };
  harness.voice = {
    channelId: null,
    privateCall: false,
    join: vi.fn(),
    leave: vi.fn(async () => {}),
  };
});

describe("FriendsProvider derived state", () => {
  it("counts incoming requests only, and unread across every conversation", () => {
    const requests: FriendRequest[] = [
      { id: "r1", user: ADA, direction: "incoming", sentAt: ISO },
      { id: "r2", user: BOB, direction: "outgoing", sentAt: ISO },
    ];
    const conversations = [
      { ...CONVERSATION, unread: 2 },
      { id: "dm-2", peer: BOB, unread: 3, updatedAt: ISO },
    ];
    harness.port = stubPort({
      listRequests: () => requests,
      listConversations: () => conversations,
    });

    const { result } = mount();

    expect(result.current.friends).toMatchObject({ incoming: 1, unread: 5, active: null });
  });

  it("marks the open conversation as read, and only while one is open", () => {
    harness.port = stubPort();
    const { result } = mount();
    expect(harness.port.markRead).not.toHaveBeenCalled();

    act(() => result.current.ui.openDm("dm-1"));

    expect(harness.port.markRead).toHaveBeenCalledWith("dm-1");
    expect(result.current.friends.active).toBe(CONVERSATION);
  });
});

describe("FriendsProvider realtime", () => {
  const STATE: SocialState = {
    friends: [],
    requests: [],
    blocked: [],
    conversations: [
      { id: "dm-ada", peer: ADA, unread: 0, updatedAt: ISO },
      { id: "dm-bob", peer: BOB, unread: 0, updatedAt: ISO },
    ],
  };

  function socialApi(): SocialApiClient {
    const unused = async () => {
      throw new Error("not used");
    };
    return {
      getSocialState: vi.fn(async () => STATE),
      sendFriendRequest: vi.fn(unused),
      acceptFriendRequest: vi.fn(unused),
      deleteFriendRequest: vi.fn(unused),
      removeFriend: vi.fn(unused),
      blockUser: vi.fn(unused),
      unblockUser: vi.fn(unused),
      openDirectConversation: vi.fn(async (userId: string) =>
        userId === ADA.id ? "dm-ada" : "dm-bob"),
      listDirectMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
      sendDirectMessage: vi.fn(unused),
      uploadAttachment: vi.fn(unused),
      markDirectConversationRead: vi.fn(async () => {}),
    };
  }

  async function mountOnAda(api: SocialApiClient, realtime: FakeRealtimeClient) {
    const adapter = createFriendsAdapter(api, realtime);
    await adapter.load();
    harness.port = adapter;
    const mounted = mount();
    act(() => mounted.result.current.friends.messagePerson(ADA.id));
    await waitFor(() => expect(mounted.result.current.ui.activeDmId).toBe("dm-ada"));
    return { mounted, adapter };
  }

  const bodyIds = (mounted: Mounted) =>
    mounted.result.current.friends.sections
      .flatMap((section) => section.groups)
      .flatMap((group) => group.bodies)
      .map((body) => body.id);

  it("appends a pushed message to its own conversation and raises unread only for the closed one", async () => {
    const realtime = new FakeRealtimeClient();
    const api = socialApi();
    const { mounted, adapter } = await mountOnAda(api, realtime);

    act(() => realtime.push("DirectMessageCreated", directMessage("dm-bob-1", BOB, "dm-bob")));

    const { friends } = mounted.result.current;
    expect(friends.conversations.find((item) => item.id === "dm-bob")).toMatchObject({
      unread: 1,
      lastMessage: { id: "dm-bob-1" },
    });
    expect(friends.unread).toBe(1);
    expect(bodyIds(mounted)).toEqual([]);

    act(() => realtime.push("DirectMessageCreated", directMessage("dm-ada-1", ADA, "dm-ada")));

    expect(bodyIds(mounted)).toEqual(["dm-ada-1"]);
    expect(mounted.result.current.friends.active?.unread).toBe(0);
    expect(mounted.result.current.friends.unread).toBe(1);
    expect(api.markDirectConversationRead).toHaveBeenCalledWith("dm-ada");
    expect(api.markDirectConversationRead).not.toHaveBeenCalledWith("dm-bob");
    adapter.dispose?.();
  });

  it("shows older messages once they have loaded", async () => {
    const api = socialApi();
    vi.mocked(api.listDirectMessages)
      .mockResolvedValueOnce({
        messages: [directMessage("newer", ADA, "dm-ada", "2026-01-02T00:00:00.000Z")],
        nextCursor: "older",
      })
      .mockResolvedValueOnce({
        messages: [directMessage("older", ADA, "dm-ada", "2026-01-01T00:00:00.000Z")],
        nextCursor: null,
      });
    const { mounted, adapter } = await mountOnAda(api, new FakeRealtimeClient());
    expect(mounted.result.current.friends.hasOlderMessages).toBe(true);
    expect(bodyIds(mounted)).toEqual(["newer"]);

    act(() => mounted.result.current.friends.loadOlderMessages());

    await waitFor(() => expect(bodyIds(mounted)).toEqual(["older", "newer"]));
    expect(mounted.result.current.friends.hasOlderMessages).toBe(false);
    expect(mounted.result.current.friends.loadingOlderMessages).toBe(false);
    adapter.dispose?.();
  });

  it("marks the signed-in person's own messages and nobody else's", async () => {
    const realtime = new FakeRealtimeClient();
    const { mounted, adapter } = await mountOnAda(socialApi(), realtime);

    act(() => {
      realtime.push("DirectMessageCreated", {
        ...directMessage("mine", ADA, "dm-ada"),
        author: { id: "u-maja", displayName: "Maja" },
      });
      realtime.push(
        "DirectMessageCreated",
        directMessage("theirs", ADA, "dm-ada", "2026-01-01T00:10:00.000Z"),
      );
    });

    const groups = mounted.result.current.friends.sections.flatMap((section) => section.groups);
    expect(groups.map((group) => [group.authorId, group.own ?? false])).toEqual([
      ["u-maja", true],
      ["u-ada", false],
    ]);
    adapter.dispose?.();
  });
});

describe("FriendsProvider sending", () => {
  async function mountWithAttachments(port: FriendsPort, names: string[]) {
    harness.port = port;
    const mounted = mount();
    act(() => mounted.result.current.ui.openDm("dm-1"));
    act(() => mounted.result.current.friends.attach(names.map(file)));
    await waitFor(() => expect(chipStatuses(mounted)).toEqual(names.map(() => "ready")));
    return mounted;
  }

  it("sends the text with its uploaded attachments, then clears the chips", async () => {
    const port = stubPort();
    const mounted = await mountWithAttachments(port, ["a.txt", "b.txt"]);

    await act(() => mounted.result.current.friends.send("here you go"));

    expect(port.sendDm).toHaveBeenCalledExactlyOnceWith("dm-1", {
      content: "here you go",
      attachmentIds: ["att-a.txt", "att-b.txt"],
      clientMessageId: expect.any(String),
    });
    expect(mounted.result.current.friends.chips).toEqual([]);
  });

  it("keeps the chips when the send fails, and retries the same message under the same id", async () => {
    const sendDm = vi.fn().mockRejectedValue(new Error("offline"));
    const mounted = await mountWithAttachments(stubPort({ sendDm }), ["a.txt"]);
    const send = (text: string) =>
      act(async () => {
        await expect(mounted.result.current.friends.send(text)).rejects.toThrow("offline");
      });

    await send("hello");
    await send("hello");
    await send("hello again");

    expect(mounted.result.current.friends.chips).toHaveLength(1);
    const ids = sendDm.mock.calls.map(([, input]) => input.clientMessageId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("does not send an empty message, and does nothing without an open conversation", async () => {
    const port = stubPort();
    harness.port = port;
    const mounted = mount();

    await act(() => mounted.result.current.friends.send("no conversation"));
    act(() => mounted.result.current.ui.openDm("dm-1"));
    await act(() => mounted.result.current.friends.send("   "));

    expect(port.sendDm).not.toHaveBeenCalled();
  });

  it("refuses to send while an attachment is still uploading", async () => {
    harness.port = stubPort({ uploadAttachment: vi.fn(() => new Promise<Attachment>(() => {})) });
    const mounted = mount();
    act(() => mounted.result.current.ui.openDm("dm-1"));
    act(() => mounted.result.current.friends.attach([file("slow.txt")]));

    await act(async () => {
      await expect(mounted.result.current.friends.send("hi")).rejects.toThrow(
        "Attachments are still uploading or need a retry.",
      );
    });
    expect(harness.port.sendDm).not.toHaveBeenCalled();
  });

  it("flags a failed upload and uploads again on retry", async () => {
    const uploadAttachment = vi
      .fn()
      .mockRejectedValueOnce(new Error("too big"))
      .mockImplementation(async (upload: File) => attachment(upload.name));
    harness.port = stubPort({ uploadAttachment });
    const mounted = mount();
    act(() => mounted.result.current.friends.attach([file("a.txt")]));
    await waitFor(() => expect(chipStatuses(mounted)).toEqual(["error"]));
    const [failed] = mounted.result.current.friends.chips;
    expect(failed).toEqual({
      id: expect.stringMatching(/^dm-chip-/),
      name: "a.txt",
      status: "error",
      error: "attachment.uploadFailed",
    });

    act(() => mounted.result.current.friends.retryChip(failed!.id));

    await waitFor(() => expect(chipStatuses(mounted)).toEqual(["ready"]));
    expect(mounted.result.current.friends.chips[0]).not.toHaveProperty("error");
  });

  it("takes at most ten attachments", async () => {
    harness.port = stubPort();
    const mounted = mount();
    const names = Array.from({ length: 12 }, (_, index) => `f${index}.txt`);

    act(() => mounted.result.current.friends.attach(names.map(file)));
    await waitFor(() => expect(chipStatuses(mounted)).toEqual(Array(10).fill("ready")));
    act(() => mounted.result.current.friends.attach([file("extra.txt")]));

    expect(mounted.result.current.friends.chips).toHaveLength(10);
  });

  it("removes and reorders attachments", async () => {
    const mounted = await mountWithAttachments(stubPort(), ["a.txt", "b.txt", "c.txt"]);
    const names = () => mounted.result.current.friends.chips.map((chip) => chip.name);

    act(() => mounted.result.current.friends.reorderChips(0, 2));
    expect(names()).toEqual(["b.txt", "c.txt", "a.txt"]);

    act(() => mounted.result.current.friends.removeChip(mounted.result.current.friends.chips[1]!.id));
    expect(names()).toEqual(["b.txt", "a.txt"]);
  });

  it("opens the conversation with a person and sends the first message on the way", async () => {
    const port = stubPort();
    harness.port = port;
    const mounted = mount();

    act(() => mounted.result.current.friends.messagePerson(ADA.id, "  hi there "));

    await waitFor(() => expect(mounted.result.current.ui.activeDmId).toBe("dm-1"));
    expect(port.openConversation).toHaveBeenCalledWith(ADA.id);
    expect(port.sendDm).toHaveBeenCalledExactlyOnceWith("dm-1", {
      content: "hi there",
      attachmentIds: [],
      clientMessageId: expect.any(String),
    });
  });

  it("opens the conversation without sending anything when there is no text", async () => {
    const port = stubPort();
    harness.port = port;
    const mounted = mount();

    act(() => mounted.result.current.friends.messagePerson(ADA.id, "   "));

    await waitFor(() => expect(mounted.result.current.ui.activeDmId).toBe("dm-1"));
    expect(port.sendDm).not.toHaveBeenCalled();
  });
});

describe("FriendsProvider friends and requests", () => {
  it("refuses to add yourself without asking the server", async () => {
    const port = stubPort();
    harness.port = port;
    const { result } = mount();

    await expect(result.current.friends.addFriend(" @MAJA ")).resolves.toBe("self");

    expect(port.addFriend).not.toHaveBeenCalled();
  });

  it.each<AddFriendResult>([
    "sent",
    "unknown-user",
    "already-friends",
    "already-sent",
    "blocked",
  ])("passes the server's answer %s through", async (answer) => {
    const port = stubPort({ addFriend: vi.fn(async () => answer) });
    harness.port = port;
    const { result } = mount();

    await expect(result.current.friends.addFriend("ada")).resolves.toBe(answer);

    expect(port.addFriend).toHaveBeenCalledExactlyOnceWith("ada");
  });

  it("adds anyone when nobody is signed in", async () => {
    harness.user = null;
    const port = stubPort();
    harness.port = port;
    const { result } = mount();

    await expect(result.current.friends.addFriend("maja")).resolves.toBe("sent");
  });

  it.each([
    ["accept", "acceptRequest"],
    ["decline", "declineRequest"],
    ["cancel", "cancelRequest"],
    ["remove", "removeFriend"],
    ["block", "block"],
    ["unblock", "unblock"],
    ["declineCall", "declineCall"],
  ] as const)("%s goes to the port and survives its failure", async (command, method) => {
    const failing = vi.fn(async () => {
      throw new Error("refused");
    });
    harness.port = stubPort({ [method]: failing });
    const { result } = mount();

    act(() => result.current.friends[command]("target-1"));

    await waitFor(() => expect(failing).toHaveBeenCalledExactlyOnceWith("target-1"));
  });
});

describe("FriendsProvider calls", () => {
  it("joins the call of an existing conversation as a private call and opens it", () => {
    harness.port = stubPort();
    const { result } = mount();

    act(() => result.current.friends.callConversation("dm-1"));

    expect(harness.voice.join).toHaveBeenCalledExactlyOnceWith("dm-1", {
      label: "Rozmowa z Ada Lovelace",
      privateCall: true,
      people: [
        { id: ADA.id, displayName: ADA.displayName, initials: "AL", presence: "online" },
      ],
    });
    expect(result.current.ui).toMatchObject({ space: "dm", activeDmId: "dm-1" });
  });

  it("ignores a call to a conversation that does not exist", () => {
    harness.port = stubPort();
    const { result } = mount();

    act(() => result.current.friends.callConversation("dm-missing"));

    expect(harness.voice.join).not.toHaveBeenCalled();
  });

  it("opens the conversation with a person before calling them", async () => {
    harness.port = stubPort({
      listConversations: () => NOTHING,
      listFriends: () => FRIENDS,
      openConversation: vi.fn(async () => "dm-bob"),
    });
    const { result } = mount();

    act(() => result.current.friends.callPerson(BOB.id));

    await waitFor(() => expect(harness.voice.join).toHaveBeenCalledOnce());
    expect(harness.voice.join).toHaveBeenCalledWith(
      "dm-bob",
      expect.objectContaining({ label: "Rozmowa z Bob", privateCall: true }),
    );
    expect(result.current.ui.activeDmId).toBe("dm-bob");
  });

  it("calls someone it knows nothing about under a generic label", async () => {
    harness.port = stubPort({ listConversations: () => NOTHING });
    const { result } = mount();

    act(() => result.current.friends.callPerson("u-stranger"));

    await waitFor(() => expect(harness.voice.join).toHaveBeenCalledOnce());
    expect(harness.voice.join).toHaveBeenCalledWith("dm-1", {
      label: "Rozmowa prywatna",
      privateCall: true,
    });
  });

  it("leaves a private call whose conversation has gone, and keeps one that is still there", () => {
    harness.port = stubPort();
    harness.voice = { ...harness.voice, privateCall: true, channelId: "dm-1" };
    mount();
    expect(harness.voice.leave).not.toHaveBeenCalled();

    harness.voice = { ...harness.voice, channelId: "dm-gone" };
    mount();

    expect(harness.voice.leave).toHaveBeenCalledOnce();
  });
});
