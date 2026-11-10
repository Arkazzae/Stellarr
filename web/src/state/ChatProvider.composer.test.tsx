import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SendMessage, ThreadSummary } from "@/ports";
import {
  attachment,
  createChatHarness,
  deferred,
  file,
  page,
} from "@/test/chatHarness";
import { at, message } from "@/test/messages";

import { ChatProvider, useChatContext, type ChatValue } from "./ChatProvider";

const world = vi.hoisted(() => ({
  h: undefined as unknown as ReturnType<typeof createChatHarness>,
}));

vi.mock("./PortsProvider", () => ({ usePorts: () => world.h.ports }));
vi.mock("./AccountProvider", () => ({ useAccountContext: () => world.h.account }));
vi.mock("./SessionProvider", () => ({ useSessionContext: () => world.h.session }));
vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => world.h.directory,
}));
vi.mock("./EmojiProvider", () => ({ useEmoji: () => world.h.emoji }));
vi.mock("./LanguageProvider", () => ({ useLanguage: () => world.h.language }));
vi.mock("./UiProvider", () => ({ useUiContext: () => world.h.ui }));
vi.mock("@/lib/audio/systemFx", () => ({ playSystemFx: vi.fn() }));

let h: typeof world.h;

beforeEach(() => {
  h = createChatHarness();
  world.h = h;
});

function Wrapper({ children }: { children: ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

async function mountLoaded() {
  const mounted = renderHook(() => useChatContext(), { wrapper: Wrapper });
  await waitFor(() => expect(mounted.result.current.loading).toBe(false));
  return mounted;
}

const bodies = (chat: ChatValue) =>
  chat.sections.flatMap((section) => section.groups.flatMap((group) => group.bodies));
const ids = (chat: ChatValue) => bodies(chat).map((body) => body.id);
const textOf = (chat: ChatValue, id: string) =>
  JSON.stringify(bodies(chat).find((body) => body.id === id)?.parts);

/** The request the nth `send` call carried. */
const sentRequest = (call = 0): SendMessage => {
  const request = h.chat.send.mock.calls[call]?.[0];
  if (request === undefined) throw new Error(`send was not called ${call + 1} times`);
  return request;
};

const SELF_AUTHOR = { id: "u-maja", displayName: "Maja" };
const BOB = { id: "u-bob", displayName: "Bob" };
const GIF = "https://giphy.com/gifs/dance-abc123";

describe("sending a message", () => {
  it("shows it at once and swaps in the server's copy when it answers", async () => {
    const answer = deferred<ReturnType<typeof serverCopy>>();
    const serverCopy = () => message("srv-1", 5, { author: SELF_AUTHOR, content: "hello" });
    h.chat.send.mockReturnValueOnce(answer.promise);
    const { result } = await mountLoaded();
    expect(result.current.ownSendToken).toBe(0);

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("hello");
    });
    expect(ids(result.current)).toEqual([sentRequest().clientMessageId]);
    expect(result.current.ownSendToken).toBe(1);
    expect(sentRequest()).toMatchObject({ channelId: "ch-general", content: "hello", attachmentIds: [] });

    await act(async () => {
      answer.resolve(serverCopy());
      await sending;
    });
    expect(ids(result.current)).toEqual(["srv-1"]);
  });

  it("does not double the message when the push arrives before the HTTP answer", async () => {
    const answer = deferred<ReturnType<typeof message>>();
    h.chat.send.mockReturnValueOnce(answer.promise);
    const { result } = await mountLoaded();
    const serverCopy = message("srv-1", 5, { author: SELF_AUTHOR, content: "hello" });

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("hello");
    });
    act(() => h.emit.message(serverCopy));
    await act(async () => {
      answer.resolve(serverCopy);
      await sending;
    });

    expect(ids(result.current)).toEqual(["srv-1"]);
  });

  it("does nothing for an empty message with no files", async () => {
    const { result } = await mountLoaded();
    await act(() => result.current.send(""));
    expect(h.chat.send).not.toHaveBeenCalled();
  });

  it("takes the message back and retries under the same client id", async () => {
    h.chat.send.mockRejectedValueOnce(new Error("offline"));
    const { result } = await mountLoaded();

    await act(async () => {
      await expect(result.current.send("hello")).rejects.toThrow("offline");
    });
    expect(ids(result.current)).toEqual([]);

    await act(() => result.current.send("hello"));
    expect(sentRequest(1).clientMessageId).toBe(sentRequest(0).clientMessageId);
  });

  it("uses a new client id once the text is different", async () => {
    h.chat.send.mockRejectedValueOnce(new Error("offline"));
    const { result } = await mountLoaded();
    await act(async () => {
      await expect(result.current.send("hello")).rejects.toThrow();
    });

    await act(() => result.current.send("hello again"));
    expect(sentRequest(1).clientMessageId).not.toBe(sentRequest(0).clientMessageId);
  });

  it("keeps the uploaded files for a retry and spends them only on success", async () => {
    h.chat.send.mockRejectedValueOnce(new Error("offline"));
    const { result } = await mountLoaded();
    act(() => result.current.attach([file("a.txt")]));
    await waitFor(() => expect(result.current.chips[0]?.status).toBe("ready"));

    await act(async () => {
      await expect(result.current.send("with file")).rejects.toThrow();
    });
    expect(result.current.chips.map((chip) => chip.name)).toEqual(["a.txt"]);

    await act(() => result.current.send("with file"));
    expect(sentRequest(1).attachmentIds).toEqual(["att-a.txt"]);
    expect(result.current.chips).toEqual([]);
  });

  it("keeps the reply bar when the send fails and clears it when it succeeds", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    h.chat.send.mockRejectedValueOnce(new Error("offline"));
    const { result } = await mountLoaded();

    act(() => result.current.startReply("m1"));
    expect(result.current.replyingTo?.id).toBe("m1");
    await act(async () => {
      await expect(result.current.send("yes")).rejects.toThrow();
    });
    expect(result.current.replyingTo?.id).toBe("m1");

    await act(() => result.current.send("yes"));
    expect(sentRequest(1).replyToMessageId).toBe("m1");
    expect(result.current.replyingTo).toBeNull();
  });
});

describe("attachments", () => {
  it("refuses to send while a file is still uploading", async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    h.chat.uploadAttachment.mockReturnValueOnce(upload.promise);
    const { result } = await mountLoaded();
    act(() => result.current.attach([file("big.bin")]));
    expect(result.current.chips[0]).toMatchObject({ name: "big.bin", status: "uploading" });

    await act(async () => {
      await expect(result.current.send("hi")).rejects.toThrow(/still uploading/);
    });
    expect(h.chat.send).not.toHaveBeenCalled();

    await act(async () => upload.resolve(attachment("big.bin")));
    expect(result.current.chips[0]?.status).toBe("ready");
  });

  it("keeps a failed upload on screen with the reason, and uploads it again on retry", async () => {
    h.chat.uploadAttachment.mockRejectedValueOnce(new Error("too large"));
    const { result } = await mountLoaded();
    act(() => result.current.attach([file("a.txt")]));
    await waitFor(() => expect(result.current.chips[0]?.status).toBe("error"));
    expect(result.current.chips[0]?.error).toBe("composer.attachmentUploadFailed");

    const chipId = result.current.chips[0]?.id ?? "";
    act(() => result.current.retryChip(chipId));
    await waitFor(() => expect(result.current.chips[0]?.status).toBe("ready"));
    expect(result.current.chips[0]?.error).toBeUndefined();
    expect(h.chat.uploadAttachment).toHaveBeenCalledTimes(2);
  });

  it("does not retry a chip that did not fail", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.attach([file("a.txt")]));
    await waitFor(() => expect(result.current.chips[0]?.status).toBe("ready"));
    act(() => result.current.retryChip(result.current.chips[0]?.id ?? ""));
    expect(h.chat.uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it("queues at most ten files, and removes and reorders chips", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.attach(Array.from({ length: 12 }, (_, i) => file(`f${i}`))));
    expect(result.current.chips).toHaveLength(10);
    await waitFor(() =>
      expect(result.current.chips.every((chip) => chip.status === "ready")).toBe(true),
    );

    act(() => result.current.reorderChips(0, 2));
    expect(result.current.chips.slice(0, 3).map((chip) => chip.name)).toEqual(["f1", "f2", "f0"]);
    const first = result.current.chips[0]?.id ?? "";
    act(() => result.current.removeChip(first));
    expect(result.current.chips).toHaveLength(9);
    expect(result.current.chips.some((chip) => chip.id === first)).toBe(false);
  });

  it("sends a recording on its own, flagged as a voice message", async () => {
    const { result } = await mountLoaded();
    const recording = file("voice.webm");

    await act(() => result.current.sendVoice(recording, 4));
    expect(h.chat.uploadAttachment).toHaveBeenCalledWith(recording, {
      voiceMessage: true,
      durationSeconds: 4,
    });
    expect(sentRequest()).toMatchObject({ content: "", attachmentIds: ["att-voice.webm"] });
  });

  it("refuses a recording while other files are queued", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.attach([file("a.txt")]));

    await act(async () => {
      await expect(result.current.sendVoice(file("v.webm"), 2)).rejects.toThrow(/without other attachments/);
    });
    expect(h.chat.send).not.toHaveBeenCalled();
  });
});

describe("sending a GIF", () => {
  it("posts the canonical page as its own message and leaves the queue alone", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.attach([file("a.txt")]));
    await waitFor(() => expect(result.current.chips[0]?.status).toBe("ready"));

    await act(() => result.current.sendGif(GIF));
    expect(sentRequest()).toMatchObject({ content: GIF, attachmentIds: [] });
    expect(result.current.chips).toHaveLength(1);
  });

  it("rejects anything that is not a canonical GIPHY page", async () => {
    const { result } = await mountLoaded();
    await act(async () => {
      await expect(result.current.sendGif("https://example.com/gifs/x-abc")).rejects.toThrow(
        "Not a canonical GIPHY GIF URL.",
      );
    });
    expect(h.chat.send).not.toHaveBeenCalled();
  });

  it("rejects when there is no channel to send to", async () => {
    h.ui.activeTextChannelId = null;
    const { result } = renderHook(() => useChatContext(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.sendGif(GIF)).rejects.toThrow("No active chat channel.");
    });
  });
});

describe("editing and deleting", () => {
  it("arms the composer with the old text and drops the reply bar", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));
    const { result } = await mountLoaded();
    act(() => result.current.startReply("m2"));

    act(() => result.current.runAction("m1", "edit"));
    expect(result.current.editing).toEqual({ id: "m1", original: "content of m1" });
    expect(result.current.replyingTo).toBeNull();

    act(() => result.current.cancelEdit());
    expect(result.current.editing).toBeNull();
  });

  it("shows the rewrite at once and asks the server to save it", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();
    act(() => result.current.runAction("m1", "edit"));

    await act(() => result.current.saveEdit("m1", "  better  "));
    expect(h.messageActions.edit).toHaveBeenCalledWith("m1", "better");
    expect(textOf(result.current, "m1")).toContain("better");
    expect(result.current.editing).toBeNull();
  });

  it("closes the editor without a request when the text did not change", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();
    act(() => result.current.runAction("m1", "edit"));

    await act(() => result.current.saveEdit("m1", "content of m1"));
    expect(h.messageActions.edit).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
  });

  it("puts the old text back and keeps the editor open when the server refuses", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    h.messageActions.edit.mockRejectedValueOnce(new Error("forbidden"));
    const { result } = await mountLoaded();

    await act(async () => {
      await expect(result.current.saveEdit("m1", "better")).rejects.toThrow("forbidden");
    });
    expect(textOf(result.current, "m1")).toContain("content of m1");
    expect(result.current.editing).toEqual({ id: "m1", original: "content of m1" });
  });

  it("removes a deleted message at once and puts it back if the server refuses", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));
    const refusal = deferred<void>();
    h.messageActions.remove.mockReturnValueOnce(refusal.promise);
    const { result } = await mountLoaded();

    act(() => result.current.runAction("m1", "delete"));
    expect(ids(result.current)).toEqual(["m2"]);
    expect(h.messageActions.remove).toHaveBeenCalledWith("m1");

    await act(async () => refusal.reject(new Error("forbidden")));
    await waitFor(() => expect(ids(result.current)).toEqual(["m1", "m2"]));
  });

  it("lets a result from search be revealed in the transcript", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.revealMessage(message("far-away", 1)));
    expect(ids(result.current)).toEqual(["far-away"]);
  });
});

describe("threads", () => {
  const root = {
    id: "m1",
    authorId: "u-ada",
    authorName: "Ada",
    preview: "content of m1",
  };
  const summary = (channelId = "ch-general"): ThreadSummary => ({
    channelId,
    root,
    replyCount: 1,
    lastReplyAt: at(3),
  });
  const reply = (id: string, minute: number) =>
    message(id, minute, { replyTo: root, author: SELF_AUTHOR });

  it("opens the whole conversation of a thread picked in the rail", async () => {
    h.chat.getThread.mockResolvedValueOnce([message("m1", 1), reply("r1", 2)]);
    const { result } = await mountLoaded();

    act(() => result.current.openThread(summary()));
    expect(result.current.openingThreadId).toBe("m1");
    expect(h.ui.closeChannelPanel).toHaveBeenCalled();
    await waitFor(() => expect(result.current.thread?.rootId).toBe("m1"));

    expect(result.current.thread?.initialExpanded).toBe(true);
    expect(result.current.openingThreadId).toBeNull();
    expect(result.current.replyingTo?.id).toBe("m1");
    // The messages joined the channel's window, not only the panel.
    expect(ids(result.current)).toEqual(["m1", "r1"]);
    expect(h.chat.getThread).toHaveBeenCalledWith("ch-general", "m1");
  });

  it("switches channel first when the thread lives in another one", async () => {
    h.directory.textChannels = [
      { id: "ch-general", name: "general" },
      { id: "ch-random", name: "random" },
    ];
    h.chat.getThread.mockResolvedValueOnce([
      message("m1", 1, { channelId: "ch-random" }),
      message("r1", 2, { channelId: "ch-random", replyTo: root }),
    ]);
    const { result, rerender } = await mountLoaded();

    act(() => result.current.openThread(summary("ch-random")));
    expect(h.ui.selectTextChannel).toHaveBeenCalledWith("ch-random");
    expect(h.chat.getThread).not.toHaveBeenCalled();

    h.ui.activeTextChannelId = "ch-random";
    rerender();
    await waitFor(() => expect(result.current.thread?.rootId).toBe("m1"));
    expect(h.chat.getThread).toHaveBeenCalledWith("ch-random", "m1");
  });

  it("leaves the rail usable when the thread cannot be read", async () => {
    h.chat.getThread.mockRejectedValueOnce(new Error("offline"));
    const { result } = await mountLoaded();

    act(() => result.current.openThread(summary()));
    await waitFor(() => expect(result.current.openingThreadId).toBeNull());
    expect(result.current.thread).toBeNull();
  });

  it("opens a thread from a message in the transcript and answers its root", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1), reply("r1", 2)]));
    const { result } = await mountLoaded();

    act(() => result.current.runAction("m1", "thread"));
    expect(result.current.thread?.rootId).toBe("m1");
    expect(result.current.thread?.initialExpanded).toBe(false);
    const threadIds = result.current.thread?.sections.flatMap((section) =>
      section.groups.flatMap((group) => group.bodies.map((body) => body.id)));
    expect(threadIds).toEqual(["m1", "r1"]);

    await act(() => result.current.send("in thread"));
    expect(sentRequest().replyToMessageId).toBe("m1");
    // Sending in a thread keeps answering its root.
    expect(result.current.replyingTo?.id).toBe("m1");
  });

  it("closes the thread and its reply bar together", async () => {
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();
    act(() => result.current.runAction("m1", "thread"));

    act(() => result.current.closeThread());
    expect(result.current.thread).toBeNull();
    expect(result.current.replyingTo).toBeNull();
  });

  it("raises the rail's summary when a reply arrives", async () => {
    h.chat.listThreads.mockResolvedValue([summary()]);
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result } = await mountLoaded();
    await waitFor(() => expect(result.current.threadsByChannel["ch-general"]).toHaveLength(1));

    act(() => h.emit.message(reply("r1", 5)));
    expect(result.current.threadsByChannel["ch-general"]?.[0]).toMatchObject({
      replyCount: 2,
      lastReplyAt: at(5),
    });
  });

  it("starts a thread row for the first reply to a message", async () => {
    const { result } = await mountLoaded();
    await waitFor(() => expect(h.chat.listThreads).toHaveBeenCalled());

    act(() => h.emit.message(reply("r1", 5)));
    expect(result.current.threadsByChannel["ch-general"]).toEqual([
      { channelId: "ch-general", root, replyCount: 1, lastReplyAt: at(5) },
    ]);
  });

  it("drops the reply bar and the open thread when the channel changes", async () => {
    h.directory.textChannels = [
      { id: "ch-general", name: "general" },
      { id: "ch-random", name: "random" },
    ];
    h.chat.listMessages.mockResolvedValueOnce(page([message("m1", 1)]));
    const { result, rerender } = await mountLoaded();
    act(() => result.current.runAction("m1", "thread"));

    h.ui.activeTextChannelId = "ch-random";
    rerender();
    expect(result.current.thread).toBeNull();
    expect(result.current.replyingTo).toBeNull();
  });
});

describe("reading", () => {
  const mark = at(1);

  it("draws the new-messages line above the first block after the read mark", async () => {
    h.chat.getReadState.mockReturnValue({ "ch-general": mark });
    h.chat.listMessages.mockResolvedValueOnce(page([message("old", 1), message("new", 2, { author: BOB })]));
    const { result } = await mountLoaded();
    expect(result.current.firstUnreadGroupId).toBe("new");
  });

  it("leaves the line where it is while you read, and clears it when you mark the channel read", async () => {
    h.chat.getReadState.mockReturnValue({ "ch-general": mark });
    h.chat.listMessages.mockResolvedValueOnce(page([message("old", 1), message("new", 2, { author: BOB })]));
    const { result } = await mountLoaded();

    act(() => h.emit.message(message("newer", 40, { author: BOB })));
    expect(result.current.firstUnreadGroupId).toBe("new");

    act(() => result.current.markChannelRead("ch-general"));
    expect(h.chat.markChannelRead).toHaveBeenCalledWith("ch-general");
    expect(result.current.firstUnreadGroupId).toBeNull();
  });

  it("marks the channel you leave as read, not the one you arrive at", async () => {
    h.directory.textChannels = [
      { id: "ch-general", name: "general" },
      { id: "ch-random", name: "random" },
    ];
    const { rerender } = await mountLoaded();
    expect(h.chat.markChannelRead).not.toHaveBeenCalled();

    h.ui.activeTextChannelId = "ch-random";
    rerender();
    expect(h.chat.markChannelRead).toHaveBeenCalledTimes(1);
    expect(h.chat.markChannelRead).toHaveBeenCalledWith("ch-general");
  });

  it("clears another channel's badge without opening it, and keeps it cleared if the request fails", async () => {
    h.directory.textChannels = [
      { id: "ch-general", name: "general" },
      { id: "ch-random", name: "random" },
    ];
    h.chat.markChannelRead.mockRejectedValue(new Error("offline"));
    const { result } = await mountLoaded();
    act(() => h.emit.message(message("x", 1, {
      channelId: "ch-random",
      author: BOB,
      createdAt: new Date().toISOString(),
    })));
    expect(result.current.unreadByChannel).toEqual({ "ch-random": 1 });

    await act(async () => result.current.markChannelRead("ch-random"));
    expect(result.current.unreadByChannel).toEqual({});
    expect(h.ui.selectTextChannel).not.toHaveBeenCalled();
  });

  it("follows a read made on another device, but never moves a mark backwards", async () => {
    h.directory.textChannels = [
      { id: "ch-general", name: "general" },
      { id: "ch-random", name: "random" },
    ];
    h.chat.getReadState.mockReturnValue({ "ch-random": at(10) });
    h.chat.listMessages.mockResolvedValue(page([]));
    const { result } = await mountLoaded();
    act(() => h.emit.message(message("x", 20, { channelId: "ch-random", author: BOB })));
    // createdAt 2026-01-01 is long before "now", so unread is judged against the mark only.
    expect(result.current.unreadByChannel).toEqual({ "ch-random": 1 });

    act(() => h.emit.readChanged("ch-random", at(5)));
    expect(result.current.unreadByChannel).toEqual({ "ch-random": 1 });

    act(() => h.emit.readChanged("ch-random", at(30)));
    expect(result.current.unreadByChannel).toEqual({});
  });
});
