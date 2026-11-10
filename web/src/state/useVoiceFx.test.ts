import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { playSystemFx } from "@/lib/audio/systemFx";
import { IDLE_VOICE_STATE, type VoicePeer, type VoiceState } from "@/lib/voice/types";

import { useVoiceFx } from "./useVoiceFx";

vi.mock("@/lib/audio/systemFx", () => ({ playSystemFx: vi.fn() }));

function peer(userId: string): VoicePeer {
  return {
    userId,
    displayName: userId,
    muted: false,
    speaking: false,
    level: 0,
    playbackVolume: 100,
    gated: false,
    suppressed: false,
    self: false,
    screen: null,
    camera: null,
  };
}

const ids = (...userIds: string[]) => userIds.map(peer);

function call(patch: Partial<VoiceState> = {}): VoiceState {
  return { ...IDLE_VOICE_STATE, channelId: "voice", connection: "connected", ...patch };
}

interface Props {
  state: VoiceState;
  shareOwnerId?: string | null;
  arrivals?: boolean;
}

const ownClips = new Set<string>();
const soundboard = {
  takeJoinAnnouncement: vi.fn((id: string) => ownClips.delete(id)),
};

function mount(initial: Props) {
  return renderHook(
    ({ state, shareOwnerId = null, arrivals = true }: Props) =>
      useVoiceFx({ soundboard, state, userId: "me", shareOwnerId, arrivals }),
    { initialProps: initial },
  );
}

const played = () => vi.mocked(playSystemFx).mock.calls.map(([name]) => name);

beforeEach(() => {
  vi.mocked(playSystemFx).mockClear();
  soundboard.takeJoinAnnouncement.mockClear();
  ownClips.clear();
});

describe("useVoiceFx", () => {
  it("chimes when this user's connection is confirmed, and when the call ends", () => {
    const view = mount({ state: call({ connection: "connecting" }) });
    expect(played()).toEqual([]);

    view.rerender({ state: call() });
    expect(played()).toEqual(["join"]);

    view.rerender({ state: IDLE_VOICE_STATE });
    expect(played()).toEqual(["join", "leave"]);
  });

  it("lets this user's own arrival clip stand in for the chime", () => {
    ownClips.add("me");
    const view = mount({ state: call({ connection: "connecting" }) });

    view.rerender({ state: call() });

    expect(played()).toEqual([]);
  });

  it("chimes once for a group that arrives together", () => {
    const view = mount({ state: call() });

    view.rerender({ state: call({ peers: ids("ada", "bartek") }) });

    expect(played()).toEqual(["join"]);
  });

  it("stays silent for an arrival that announced itself with a clip", () => {
    ownClips.add("ada");
    const view = mount({ state: call() });

    view.rerender({ state: call({ peers: ids("ada") }) });

    expect(played()).toEqual([]);
  });

  it("still chimes for the second of two arrivals when only one has a clip", () => {
    ownClips.add("ada");
    const view = mount({ state: call() });

    view.rerender({ state: call({ peers: ids("ada", "bartek") }) });

    expect(played()).toEqual(["join"]);
    expect(soundboard.takeJoinAnnouncement).toHaveBeenCalledWith("ada");
    expect(soundboard.takeJoinAnnouncement).toHaveBeenCalledWith("bartek");
  });

  it("chimes when somebody leaves", () => {
    const view = mount({ state: call({ peers: ids("ada") }) });

    view.rerender({ state: call({ peers: [] }) });

    expect(played()).toEqual(["leave"]);
  });

  it("ignores speaking changes that leave membership alone", () => {
    const view = mount({ state: call({ peers: ids("ada") }) });

    view.rerender({ state: call({ peers: [{ ...peer("ada"), speaking: true, level: 0.8 }] }) });

    expect(played()).toEqual([]);
  });

  it("chimes once for people already present when the connection is confirmed", () => {
    const view = mount({ state: call({ connection: "connecting" }) });

    view.rerender({ state: call({ peers: ids("ada", "bartek") }) });

    expect(played()).toEqual(["join"]);
  });

  it("is silent for every coming and going once arrivals are off", () => {
    const view = mount({ state: call({ connection: "connecting" }), arrivals: false });

    view.rerender({ state: call(), arrivals: false });
    view.rerender({ state: call({ peers: ids("ada") }), arrivals: false });
    view.rerender({ state: call({ peers: [] }), arrivals: false });
    view.rerender({ state: IDLE_VOICE_STATE, arrivals: false });

    expect(played()).toEqual([]);
  });

  it("gives a share its own sounds, whatever the arrivals preference says", () => {
    const view = mount({ state: call(), arrivals: false });

    view.rerender({ state: call(), arrivals: false, shareOwnerId: "ada" });
    expect(played()).toEqual(["stream"]);

    view.rerender({ state: call(), arrivals: false, shareOwnerId: null });
    expect(played()).toEqual(["stream", "leave"]);
  });

  it("does not add a share-ended sound on top of leaving the call", () => {
    const view = mount({ state: call(), shareOwnerId: "ada" });

    view.rerender({ state: IDLE_VOICE_STATE, shareOwnerId: null });

    expect(played()).toEqual(["leave"]);
  });
});
