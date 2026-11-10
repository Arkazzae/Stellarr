import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { playSystemFx } from "@/lib/audio/systemFx";
import type { VoiceClient, VoicePeer } from "@/lib/voice/types";
import { DEFAULT_SETTINGS } from "@/lib/voice/settings";
import type { Ports, SoundboardState } from "@/ports";
import { FakeVoiceClient } from "@/test/fakes";

import { VoiceProvider, useVoiceContext } from "./VoiceProvider";

const harness = vi.hoisted(() => ({
  client: undefined as unknown as VoiceClient,
  ports: undefined as unknown as Ports,
  preferences: { joinLeaveSound: true },
}));

vi.mock("@/lib/audio/systemFx", () => ({ playSystemFx: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ triggerHaptic: vi.fn() }));

vi.mock("./AccountProvider", () => ({
  useAccountContext: () => ({ preferences: harness.preferences }),
}));

vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => ({
    channelName: (channelId: string | null) => channelId ?? "",
    occupantsOf: () => [],
  }),
}));

vi.mock("./LanguageProvider", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("./PortsProvider", () => ({
  usePorts: () => harness.ports,
}));

vi.mock("./SessionProvider", () => ({
  useSessionContext: () => ({
    user: { id: "self", displayName: "Self" },
  }),
}));

const SOUNDBOARD: SoundboardState = Object.freeze({
  sounds: [],
  settings: { everyoneCanPlay: true, rateLimited: true },
  canManage: false,
  supported: true,
  loading: false,
  error: null,
});

function peer(userId: string, streamId: string): VoicePeer {
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
    screen: { streamId, hasAudio: false, stream: null },
    camera: null,
  };
}

function Probe() {
  const voice = useVoiceContext();
  return (
    <div>
      <output aria-label="share-owner">{voice.share?.ownerId ?? "none"}</output>
      <output aria-label="watching">{String(voice.share?.watching ?? false)}</output>
      <button type="button" onClick={voice.watchShare}>Watch</button>
    </div>
  );
}

beforeEach(() => {
    harness.client = new FakeVoiceClient();
    harness.preferences = { joinLeaveSound: true };
    vi.mocked(playSystemFx).mockClear();
    harness.ports = {
      createVoice: vi.fn(() => harness.client),
      voiceSettings: {
        getSnapshot: () => DEFAULT_SETTINGS,
        subscribe: () => () => {},
        update: vi.fn(),
        reset: vi.fn(),
      },
      soundboard: {
        getSnapshot: () => SOUNDBOARD,
        subscribe: () => () => {},
        setVolume: vi.fn(),
        setDeafened: vi.fn(),
        preparePlayback: vi.fn(),
        cooldownRemaining: () => 0,
        takeJoinAnnouncement: vi.fn(() => false),
        setArrivalsAudible: vi.fn(),
      },
    } as unknown as Ports;
});

describe("VoiceProvider share opt-in", () => {
  it("does not carry watching across a new stream or owner during reconnect", async () => {
    render(
      <VoiceProvider>
        <Probe />
      </VoiceProvider>,
    );
    await waitFor(() => expect(harness.ports.createVoice).toHaveBeenCalledOnce());

    act(() => {
      (harness.client as FakeVoiceClient).set({
        channelId: "voice",
        connection: "connected",
        peers: [peer("ada", "screen-a-1")],
      });
    });
    expect(screen.getByLabelText("share-owner")).toHaveTextContent("ada");
    expect(screen.getByLabelText("watching")).toHaveTextContent("false");

    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(screen.getByLabelText("watching")).toHaveTextContent("true");

    act(() => {
      (harness.client as FakeVoiceClient).set({ peers: [peer("ada", "screen-a-2")] });
    });
    expect(screen.getByLabelText("watching")).toHaveTextContent("false");

    act(() => {
      (harness.client as FakeVoiceClient).set({ peers: [peer("bartek", "screen-b-1")] });
    });
    expect(screen.getByLabelText("share-owner")).toHaveTextContent("bartek");
    expect(screen.getByLabelText("watching")).toHaveTextContent("false");
  });
});

describe("VoiceProvider arrival sounds", () => {
  function talker(userId: string): VoicePeer {
    return { ...peer(userId, "unused"), screen: null };
  }

  it("announces a join and a departure while the preference stands", async () => {
    render(
      <VoiceProvider>
        <Probe />
      </VoiceProvider>,
    );
    await waitFor(() => expect(harness.ports.createVoice).toHaveBeenCalledOnce());

    act(() => {
      (harness.client as FakeVoiceClient).set({
        channelId: "voice",
        connection: "connected",
        peers: [],
      });
    });
    expect(playSystemFx).toHaveBeenCalledWith("join");

    act(() => {
      (harness.client as FakeVoiceClient).set({ peers: [talker("ada")] });
    });
    act(() => {
      (harness.client as FakeVoiceClient).set({ peers: [] });
    });
    expect(playSystemFx).toHaveBeenCalledWith("leave");
  });

  it("stays quiet for every coming and going once the preference is off", async () => {
    harness.preferences = { joinLeaveSound: false };
    render(
      <VoiceProvider>
        <Probe />
      </VoiceProvider>,
    );
    await waitFor(() => expect(harness.ports.createVoice).toHaveBeenCalledOnce());

    act(() => {
      (harness.client as FakeVoiceClient).set({
        channelId: "voice",
        connection: "connected",
        peers: [],
      });
    });
    act(() => {
      (harness.client as FakeVoiceClient).set({ peers: [talker("ada")] });
    });
    act(() => {
      (harness.client as FakeVoiceClient).set({ peers: [] });
    });

    expect(playSystemFx).not.toHaveBeenCalledWith("join");
    expect(playSystemFx).not.toHaveBeenCalledWith("leave");
    // The soundboard is told as well: an arrival clip is the same
    // announcement, only longer.
    expect(harness.ports.soundboard.setArrivalsAudible).toHaveBeenCalledWith(false);
  });
});
