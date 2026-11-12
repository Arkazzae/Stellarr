import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DmRoomProps } from "@/components/friends/DmRoom";
import type { FriendsViewProps } from "@/components/friends/FriendsView";
import { formatDate } from "@/lib/format";
import type {
  FriendsValue,
  LanguageValue,
  UiValue,
  VoiceValue,
} from "@/state/hooks";
import { fakeLanguage, fakeUi, fakeVoice } from "@/test/roomFakes";

import { FriendsRoomContainer } from "./FriendsRoomContainer";

const mocks = vi.hoisted(() => ({
  friends: null as unknown as FriendsValue,
  ui: null as unknown as UiValue,
  voice: null as unknown as VoiceValue,
  language: null as unknown as LanguageValue,
  profile: { toggle: vi.fn() },
  seen: {
    room: null as DmRoomProps | null,
    view: null as FriendsViewProps | null,
  },
}));

vi.mock("@/state/hooks", () => ({
  useFriends: () => mocks.friends,
  useUi: () => mocks.ui,
  useVoice: () => mocks.voice,
  useLanguage: () => mocks.language,
  useProfile: () => mocks.profile,
  useSession: () => ({ user: { id: "u-maja" } }),
  useEmoji: () => ({ emoji: [] }),
}));

vi.mock("./NotificationInboxContainer", () => ({
  NotificationInboxButton: () => <button type="button">inbox</button>,
}));

vi.mock("@/components/friends/DmRoom", () => ({
  DmRoom: (props: DmRoomProps) => {
    mocks.seen.room = props;
    return <div data-testid="dm-room">{props.notificationButton}</div>;
  },
}));

vi.mock("@/components/friends/FriendsView", () => ({
  FriendsView: (props: FriendsViewProps) => {
    mocks.seen.view = props;
    return <div data-testid="friends-view">{props.notificationButton}</div>;
  },
}));

const ADA = { id: "u-ada", username: "ada", displayName: "Ada Lovelace", presence: "online" } as const;
const BOB = { id: "u-bob", username: "bob", displayName: "Bob", presence: "offline" } as const;
const EVE = { id: "u-eve", username: "eve", displayName: "Eve", presence: "away", avatarUrl: "/eve.png" } as const;

function fakeFriends(overrides: Record<string, unknown> = {}): FriendsValue {
  return {
    friends: [],
    requests: [],
    blocked: [],
    active: null,
    sections: [],
    hasOlderMessages: false,
    loadingOlderMessages: false,
    chips: [],
    messagePerson: vi.fn(),
    callPerson: vi.fn(),
    callConversation: vi.fn(),
    send: vi.fn(async () => {}),
    loadOlderMessages: vi.fn(),
    attach: vi.fn(),
    retryChip: vi.fn(),
    removeChip: vi.fn(),
    reorderChips: vi.fn(),
    addFriend: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    block: vi.fn(),
    unblock: vi.fn(),
    ...overrides,
  } as unknown as FriendsValue;
}

const conversation = { id: "dm-ada", peer: ADA, callParticipants: [] as string[] };
const view = () => mocks.seen.view!;
const room = () => mocks.seen.room!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.friends = fakeFriends();
  mocks.ui = fakeUi({ friendsTab: "all" } as Partial<UiValue>);
  mocks.voice = fakeVoice();
  mocks.language = fakeLanguage();
  mocks.profile = { toggle: vi.fn() };
  mocks.seen.room = null;
  mocks.seen.view = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FriendsRoomContainer without a conversation", () => {
  it("shows the list of people, not a conversation", () => {
    render(<FriendsRoomContainer />);

    expect(screen.getByTestId("friends-view")).toBeInTheDocument();
    expect(screen.queryByTestId("dm-room")).toBeNull();
    expect(screen.getByRole("button", { name: "inbox" })).toBeInTheDocument();
  });

  it("lists friends alphabetically with the date the friendship began", () => {
    mocks.friends = fakeFriends({
      friends: [
        { user: BOB, since: "2026-03-01T10:00:00Z" },
        { user: ADA, since: "2026-01-15T10:00:00Z" },
      ],
    });

    render(<FriendsRoomContainer />);

    expect(view().friends).toEqual([
      {
        person: expect.objectContaining({ id: "u-ada", initials: "AL" }),
        username: "ada",
        since: formatDate("2026-01-15T10:00:00Z", "pl"),
      },
      {
        person: expect.objectContaining({ id: "u-bob", initials: "BO" }),
        username: "bob",
        since: formatDate("2026-03-01T10:00:00Z", "pl"),
      },
    ]);
  });

  it("describes requests by direction and blocked people without a date", () => {
    mocks.friends = fakeFriends({
      requests: [
        { id: "r-1", user: BOB, direction: "incoming", sentAt: new Date().toISOString() },
      ],
      blocked: [EVE],
    });

    render(<FriendsRoomContainer />);

    expect(view().requests).toEqual([
      expect.objectContaining({ id: "r-1", username: "bob", direction: "incoming" }),
    ]);
    expect(view().requests[0]!.when).not.toBe("");
    expect(view().blocked).toEqual([
      {
        person: expect.objectContaining({ id: "u-eve", avatarUrl: "/eve.png" }),
        username: "eve",
      },
    ]);
    expect(view().blocked[0]).not.toHaveProperty("since");
  });

  it("hands every action to the friends state, and the tab to the ui", () => {
    render(<FriendsRoomContainer />);

    expect(view()).toMatchObject({
      tab: "all",
      onTabChange: mocks.ui.setFriendsTab,
      onMessage: mocks.friends.messagePerson,
      onCall: mocks.friends.callPerson,
      onRemove: mocks.friends.remove,
      onBlock: mocks.friends.block,
      onUnblock: mocks.friends.unblock,
      onAccept: mocks.friends.accept,
      onDecline: mocks.friends.decline,
      onCancel: mocks.friends.cancel,
      onAddFriend: mocks.friends.addFriend,
      onOpenProfile: mocks.profile.toggle,
    });
  });
});

describe("FriendsRoomContainer with a conversation", () => {
  beforeEach(() => {
    mocks.friends = fakeFriends({ active: conversation });
  });

  it("shows that conversation, not the list", () => {
    render(<FriendsRoomContainer />);

    expect(screen.getByTestId("dm-room")).toBeInTheDocument();
    expect(screen.queryByTestId("friends-view")).toBeNull();
    expect(screen.getByRole("button", { name: "inbox" })).toBeInTheDocument();
    expect(room().peer).toMatchObject({ id: "u-ada", displayName: "Ada Lovelace" });
  });

  it("sends, pages and attaches through the friends state", () => {
    render(<FriendsRoomContainer />);

    expect(room()).toMatchObject({
      onSend: mocks.friends.send,
      onLoadOlderMessages: mocks.friends.loadOlderMessages,
      onAttach: mocks.friends.attach,
      onRemoveChip: mocks.friends.removeChip,
      onRetryChip: mocks.friends.retryChip,
      onReorderChips: mocks.friends.reorderChips,
      onOpenProfile: mocks.profile.toggle,
      localPersonId: "u-maja",
    });
  });

  it("knows whether someone is in the conversation's call and whether you are", () => {
    mocks.friends = fakeFriends({
      active: { ...conversation, callParticipants: ["u-ada"] },
    });
    const rendered = render(<FriendsRoomContainer />);
    expect(room()).toMatchObject({ callActive: true, inCall: false });

    mocks.voice = fakeVoice({ channelId: "dm-ada" });
    rendered.rerender(<FriendsRoomContainer />);
    expect(room()).toMatchObject({ callActive: true, inCall: true });
  });

  it("starts or joins the conversation's call", () => {
    render(<FriendsRoomContainer />);

    room().onCall();

    expect(mocks.friends.callConversation).toHaveBeenCalledExactlyOnceWith("dm-ada");
  });

  it("turns the camera on once a video call has been joined", () => {
    vi.useFakeTimers();
    render(<FriendsRoomContainer />);

    room().onVideoCall();

    expect(mocks.friends.callConversation).toHaveBeenCalledExactlyOnceWith("dm-ada");
    expect(mocks.voice.toggleCamera).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(mocks.voice.toggleCamera).toHaveBeenCalledOnce();
  });

  it("only toggles the camera when the call is already up", () => {
    mocks.voice = fakeVoice({ channelId: "dm-ada" });
    render(<FriendsRoomContainer />);

    room().onVideoCall();

    expect(mocks.voice.toggleCamera).toHaveBeenCalledOnce();
    expect(mocks.friends.callConversation).not.toHaveBeenCalled();
  });

  it("gives the call its people and tells the room whether the camera is on", () => {
    mocks.voice = fakeVoice({
      people: [{ id: "u-ada" }] as VoiceValue["people"],
      call: { cameraOn: true } as VoiceValue["call"],
    });

    render(<FriendsRoomContainer />);

    expect(room().callPeople).toBe(mocks.voice.people);
    expect(room().videoOn).toBe(true);
    expect(room().onParticipantVolumeChange).toBe(mocks.voice.setParticipantVolume);
  });

  it("passes the translation settings on", () => {
    mocks.language = fakeLanguage({
      chatTranslationEnabled: true,
      chatTranslationTargetLanguage: "pl",
    });

    render(<FriendsRoomContainer />);

    expect(room().translation).toMatchObject({ enabled: true, targetLanguage: "pl" });
  });
});
