import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelPanelProps } from "@/components/room/ChannelPanel";
import type { ComposerProps } from "@/components/room/Composer";
import type { MediaViewerProps } from "@/components/room/MediaViewer";
import type { TranscriptProps } from "@/components/room/Transcript";
import type {
  ChatValue,
  DirectoryValue,
  LanguageValue,
  UiValue,
  VoiceValue,
} from "@/state/hooks";
import {
  fakeChat,
  fakeDirectory,
  fakeLanguage,
  fakeUi,
  fakeVoice,
  t,
} from "@/test/roomFakes";

import { RoomContainer } from "./RoomContainer";

type ThreadPanelStubProps = TranscriptProps & {
  open: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onClose: () => void;
  composer?: unknown;
};

const mocks = vi.hoisted(() => {
  const deviceSettings = {};
  return {
    directory: null as unknown as DirectoryValue,
    chat: null as unknown as ChatValue,
    ui: null as unknown as UiValue,
    language: null as unknown as LanguageValue,
    voice: null as unknown as VoiceValue,
    preferences: { developerMode: false },
    profile: { toggle: vi.fn() },
    ports: {
      voiceSettings: { subscribe: () => () => {}, getSnapshot: () => deviceSettings },
      chat: { listIndexed: async () => ({ messages: [], nextCursor: null }) },
    },
    seen: {
      transcript: null as TranscriptProps | null,
      thread: null as ThreadPanelStubProps | null,
      composers: [] as ComposerProps[],
      panel: null as ChannelPanelProps | null,
      viewer: null as MediaViewerProps | null,
    },
  };
});

vi.mock("@/state/hooks", () => ({
  useDirectory: () => mocks.directory,
  useSession: () => ({ user: { id: "u-maja" } }),
  useUi: () => mocks.ui,
  useChat: () => mocks.chat,
  useVoice: () => mocks.voice,
  useEmoji: () => ({ emoji: [] }),
  useLanguage: () => mocks.language,
  useAccount: () => ({ preferences: mocks.preferences }),
  useProfile: () => mocks.profile,
  usePorts: () => mocks.ports,
}));

vi.mock("./CallStage", () => ({ CallStage: () => null }));

vi.mock("./NotificationInboxContainer", () => ({
  NotificationInboxButton: () => <button type="button">inbox</button>,
}));

vi.mock("@/components/room/Transcript", () => ({
  Transcript: (props: TranscriptProps) => {
    mocks.seen.transcript = props;
    return <div role="log" aria-label={props.label} />;
  },
}));

vi.mock("@/components/room/ThreadPanel", () => ({
  ThreadPanel: (props: ThreadPanelStubProps) => {
    mocks.seen.thread = props;
    return (
      <aside aria-label="thread-stub" data-open={props.open}>
        {props.composer as never}
      </aside>
    );
  },
}));

vi.mock("@/components/room/Composer", () => ({
  Composer: (props: ComposerProps) => {
    mocks.seen.composers.push(props);
    return (
      <form aria-label="composer-stub" data-channel={props.channelName}>
        <button type="button" onClick={() => void props.onSubmit("hello")}>
          submit
        </button>
        {props.replyingTo === null || props.replyingTo === undefined ? null : (
          <button type="button" onClick={props.onCancelReply}>
            reply to {props.replyingTo.authorName}
          </button>
        )}
      </form>
    );
  },
}));

vi.mock("@/components/room/ChannelPanel", () => ({
  ChannelPanel: (props: ChannelPanelProps) => {
    mocks.seen.panel = props;
    return <div data-testid="channel-panel" data-open={props.open} data-tab={props.tab} />;
  },
}));

vi.mock("@/components/room/MediaViewer", () => ({
  MediaViewer: (props: MediaViewerProps) => {
    mocks.seen.viewer = props;
    return props.target === null ? null : (
      <div role="dialog" aria-label={`viewer-${props.target.kind}`} />
    );
  },
}));

beforeEach(() => {
  mocks.directory = fakeDirectory();
  mocks.chat = fakeChat();
  mocks.ui = fakeUi();
  mocks.language = fakeLanguage();
  mocks.voice = fakeVoice();
  mocks.preferences = { developerMode: false };
  mocks.profile = { toggle: vi.fn() };
  mocks.seen.transcript = null;
  mocks.seen.thread = null;
  mocks.seen.composers = [];
  mocks.seen.panel = null;
  mocks.seen.viewer = null;
});

const seenTranscript = () => mocks.seen.transcript!;
const seenThread = () => mocks.seen.thread!;
const seenPanel = () => mocks.seen.panel!;

describe("RoomContainer text room", () => {
  it("shows the active channel's transcript, composer and header", () => {
    render(<RoomContainer />);

    expect(screen.getByRole("log", { name: t("room.messagesOn", { channel: "general" }) }))
      .toBeInTheDocument();
    expect(screen.getByRole("form", { name: "composer-stub" })).toHaveAttribute(
      "data-channel",
      "general",
    );
    expect(screen.getByRole("heading", { name: "general" })).toBeInTheDocument();
    expect(screen.getByText("Anything.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "inbox" })).toBeInTheDocument();
  });

  it("lays out an empty room when no text channel is open", () => {
    mocks.ui = fakeUi({ activeTextChannelId: null });
    mocks.chat = fakeChat({ channelId: null });

    render(<RoomContainer />);

    expect(screen.getByRole("log", { name: t("room.messagesOn", { channel: "" }) }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("");
  });

  it("sends what the composer submits through the chat", async () => {
    const user = userEvent.setup();
    render(<RoomContainer />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(mocks.chat.send).toHaveBeenCalledExactlyOnceWith("hello");
  });

  it("names the message being answered and lets the reader drop it", async () => {
    const user = userEvent.setup();
    mocks.chat = fakeChat({
      replyingTo: { id: "m-1", authorId: "u-ada", authorName: "Ada", preview: "Lunch?" },
    });
    render(<RoomContainer />);

    expect(mocks.seen.composers.at(-1)?.replyingTo).toEqual({
      id: "m-1",
      authorName: "Ada",
      preview: "Lunch?",
    });
    await user.click(screen.getByRole("button", { name: "reply to Ada" }));

    expect(mocks.chat.cancelReply).toHaveBeenCalledOnce();
  });

  it("hands the transcript the moderation and display settings", () => {
    mocks.directory = fakeDirectory({ canManageMessages: true });
    mocks.preferences = { developerMode: true };
    mocks.chat = fakeChat({ hasOlder: true, firstUnreadGroupId: "g-9", ownSendToken: 4 });

    render(<RoomContainer />);

    expect(seenTranscript()).toMatchObject({
      canModerate: true,
      developerMode: true,
      hasOlder: true,
      firstUnreadGroupId: "g-9",
      followOwnSend: 4,
      onLoadOlder: mocks.chat.loadOlder,
      onReact: mocks.chat.react,
      onAction: mocks.chat.runAction,
    });
  });

  it("opens a profile from an author", () => {
    render(<RoomContainer />);
    const anchor = document.createElement("button");

    seenTranscript().onOpenAuthor?.("u-ada", anchor);

    expect(mocks.profile.toggle).toHaveBeenCalledExactlyOnceWith("u-ada", anchor);
  });
});

describe("RoomContainer translation", () => {
  it("leaves translation off until the language settings turn it on", () => {
    const view = render(<RoomContainer />);

    expect(seenTranscript().translation).toMatchObject({
      enabled: false,
      autoTranslate: false,
    });

    mocks.language = fakeLanguage({
      chatTranslationEnabled: true,
      chatAutoTranslateEnabled: true,
      chatTranslationTargetLanguage: "pl",
    });
    view.rerender(<RoomContainer />);

    expect(seenTranscript().translation).toMatchObject({
      enabled: true,
      autoTranslate: true,
      targetLanguage: "pl",
    });
  });

  it("gives an open thread the same translation settings as the channel", () => {
    mocks.language = fakeLanguage({ chatTranslationEnabled: true });
    render(<RoomContainer />);

    expect(seenThread().translation).toBe(seenTranscript().translation);
  });
});

describe("RoomContainer thread", () => {
  const thread = {
    rootId: "m-1",
    sections: [],
    initialExpanded: true,
    openRevision: 1,
  };

  it("moves the composer into the open thread and drops the channel's reply target", () => {
    mocks.chat = fakeChat({
      thread,
      replyingTo: { id: "m-1", authorId: "u-ada", authorName: "Ada", preview: "Lunch?" },
    });

    render(<RoomContainer />);

    const panel = screen.getByRole("complementary", { name: "thread-stub" });
    expect(within(panel).getByRole("form", { name: "composer-stub" })).toBeInTheDocument();
    expect(screen.getAllByRole("form", { name: "composer-stub" })).toHaveLength(1);
    const composer = mocks.seen.composers.at(-1)!;
    expect(composer.placeholder).toBe(t("room.threadPlaceholder"));
    expect(composer.replyingTo).toBeNull();
    expect(composer.onCancelReply).toBeUndefined();
    expect(composer.recordingScope).toBe("ch-general:thread:m-1");
  });

  it("opens in the layout the opener asked for and remembers the reader's change", () => {
    mocks.chat = fakeChat({ thread });
    const { container } = render(<RoomContainer />);
    const room = container.querySelector("main")!;

    expect(room).toHaveClass("thread-panel-open", "thread-panel-expanded");
    expect(seenThread()).toMatchObject({ open: true, expanded: true });

    act(() => seenThread().onExpandedChange(false));

    expect(room).toHaveClass("thread-panel-open");
    expect(room).not.toHaveClass("thread-panel-expanded");
  });

  it("closes through the chat", () => {
    mocks.chat = fakeChat({ thread });
    render(<RoomContainer />);

    seenThread().onClose();

    expect(mocks.chat.closeThread).toHaveBeenCalledOnce();
  });
});

describe("RoomContainer channel panel", () => {
  it("is closed until the ui opens it, on the tab the ui last showed", () => {
    mocks.ui = fakeUi({ channelPanelTab: "links" });
    const view = render(<RoomContainer />);

    expect(screen.getByTestId("channel-panel")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("channel-panel")).toHaveAttribute("data-tab", "links");
    expect(view.container.querySelector("main")).not.toHaveClass("channel-panel-open");

    mocks.ui = fakeUi({ channelPanel: "links", channelPanelTab: "links" });
    view.rerender(<RoomContainer />);

    expect(screen.getByTestId("channel-panel")).toHaveAttribute("data-open", "true");
    expect(view.container.querySelector("main")).toHaveClass("channel-panel-open");
  });

  it("is toggled by the header on the tab it last showed, closing any thread", async () => {
    const user = userEvent.setup();
    mocks.ui = fakeUi({ channelPanelTab: "media" });
    render(<RoomContainer />);

    await user.click(screen.getByRole("button", { name: t("room.channelPanel") }));

    expect(mocks.ui.toggleChannelPanel).toHaveBeenCalledExactlyOnceWith("media");
    expect(mocks.chat.closeThread).toHaveBeenCalledOnce();
  });

  it("lets a pin scroll the transcript once the transcript has lent its scroll", () => {
    const jump = vi.fn();
    render(<RoomContainer />);

    seenPanel().onOpenPin?.("m-7");
    expect(jump).not.toHaveBeenCalled();

    act(() => seenTranscript().onJumpReady?.(jump));
    seenPanel().onOpenPin?.("m-7");

    expect(jump).toHaveBeenCalledExactlyOnceWith("m-7");
  });
});

describe("RoomContainer attachments", () => {
  function drop(files: File[]) {
    const payload = { dataTransfer: { types: ["Files"], files } };
    fireEvent.dragEnter(window, payload);
    fireEvent.drop(window, payload);
  }

  it("attaches files dropped on the room", () => {
    render(<RoomContainer />);
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];

    drop(files);

    expect(mocks.chat.attach).toHaveBeenCalledExactlyOnceWith(files);
  });

  it("ignores a drop when there is no text channel to attach to", () => {
    mocks.ui = fakeUi({ activeTextChannelId: null });
    render(<RoomContainer />);

    drop([new File(["a"], "a.txt")]);

    expect(mocks.chat.attach).not.toHaveBeenCalled();
  });

  it("opens an image from a message in the viewer and closes it again", () => {
    render(<RoomContainer />);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() =>
      seenTranscript().attachments?.onOpenImage?.(
        [{ src: "/a.png", alt: "a" }, { src: "/b.png", alt: "b" }],
        1,
      ),
    );

    expect(screen.getByRole("dialog", { name: "viewer-image" })).toBeInTheDocument();
    expect(mocks.seen.viewer?.target).toMatchObject({ kind: "image", index: 1 });

    act(() => mocks.seen.viewer?.onClose());

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shares one set of attachment callbacks with the transcript, thread and panel", () => {
    render(<RoomContainer />);

    expect(seenThread().attachments).toBe(seenTranscript().attachments);
    expect(seenPanel().callbacks).toBe(seenTranscript().attachments);
    expect(seenTranscript().attachments?.giphyCustomerId).toBe("u-maja");
  });
});
