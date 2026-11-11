import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { playSystemFx } from "@/lib/audio/systemFx";
import { triggerHaptic } from "@/lib/haptics";
import { DEFAULT_SETTINGS } from "@/lib/voice/settings";
import type { VoiceClient } from "@/lib/voice/types";
import type { Ports, SoundboardState } from "@/ports";
import { FakeVoiceClient } from "@/test/fakes";

import { VoiceProvider, useVoiceContext, type VoiceValue } from "./VoiceProvider";

const harness = vi.hoisted(() => ({
  client: undefined as unknown as VoiceClient,
  ports: undefined as unknown as Ports,
  user: null as { id: string; displayName: string } | null,
  soundboard: undefined as unknown as SoundboardState,
}));

vi.mock("@/lib/audio/systemFx", () => ({ playSystemFx: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ triggerHaptic: vi.fn() }));
vi.mock("./AccountProvider", () => ({
  useAccountContext: () => ({ preferences: { joinLeaveSound: true } }),
}));
vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => ({
    channelName: (channelId: string | null) => (channelId === null ? "" : `#${channelId}`),
    occupantsOf: () => [],
  }),
}));
vi.mock("./LanguageProvider", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("./PortsProvider", () => ({ usePorts: () => harness.ports }));
vi.mock("./SessionProvider", () => ({
  useSessionContext: () => ({ user: harness.user }),
}));

const SOUNDBOARD: SoundboardState = Object.freeze({
  sounds: [],
  settings: { everyoneCanPlay: true, rateLimited: true },
  canManage: false,
  supported: true,
  loading: false,
  error: null,
});

function wrapper({ children }: { children: ReactNode }) {
  return <VoiceProvider>{children}</VoiceProvider>;
}

function mount() {
  return renderHook(() => useVoiceContext(), { wrapper });
}

const fake = () => harness.client as FakeVoiceClient;

beforeEach(() => {
  vi.mocked(playSystemFx).mockClear();
  vi.mocked(triggerHaptic).mockClear();
  harness.client = new FakeVoiceClient();
  harness.user = { id: "self", displayName: "Self" };
  harness.soundboard = SOUNDBOARD;
  harness.ports = {
    createVoice: vi.fn(() => harness.client),
    voiceSettings: {
      getSnapshot: () => DEFAULT_SETTINGS,
      subscribe: () => () => {},
      update: vi.fn(),
      reset: vi.fn(),
    },
    soundboard: {
      getSnapshot: () => harness.soundboard,
      subscribe: () => () => {},
      setVolume: vi.fn(),
      setDeafened: vi.fn(),
      preparePlayback: vi.fn(),
      cooldownRemaining: () => 0,
      takeJoinAnnouncement: vi.fn(() => false),
      setArrivalsAudible: vi.fn(),
      play: vi.fn(async () => {}),
    },
  } as unknown as Ports;
});

describe("VoiceProvider client lifecycle", () => {
  it("creates the client for the signed-in user and disposes it on unmount", () => {
    const view = mount();

    expect(harness.ports.createVoice).toHaveBeenCalledWith({
      userId: "self",
      displayName: "Self",
      translate: expect.any(Function),
    });

    view.unmount();
    expect(fake().dispose).toHaveBeenCalled();
  });

  it("creates no client while signed out", () => {
    harness.user = null;

    mount();

    expect(harness.ports.createVoice).not.toHaveBeenCalled();
  });

  it("honours a join asked for before a client existed", () => {
    harness.user = null;
    const view = mount();

    act(() => view.result.current.join("voice"));
    expect(fake().join).not.toHaveBeenCalled();

    harness.user = { id: "self", displayName: "Self" };
    view.rerender();

    expect(fake().join).toHaveBeenCalledWith("voice");
  });

  it("drops a queued join when the caller leaves before a client exists", async () => {
    harness.user = null;
    const view = mount();
    act(() => view.result.current.join("voice"));

    await act(() => view.result.current.leave());
    harness.user = { id: "self", displayName: "Self" };
    view.rerender();

    expect(fake().join).not.toHaveBeenCalled();
  });

  it("pushes the persisted settings and the soundboard volume into the new client", () => {
    mount();

    expect(fake().applySettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(harness.ports.soundboard.setVolume).toHaveBeenCalledWith(
      DEFAULT_SETTINGS.soundboardVolume,
    );
  });
});

describe("VoiceProvider joining and leaving", () => {
  it("primes playback and joins through the client", () => {
    const view = mount();

    act(() => view.result.current.join("voice"));

    expect(harness.ports.soundboard.preparePlayback).toHaveBeenCalled();
    expect(fake().join).toHaveBeenCalledWith("voice");
    expect(triggerHaptic).toHaveBeenCalledWith("light");
  });

  it("does not rejoin a channel it is already connected to", () => {
    const view = mount();
    act(() => fake().set({ channelId: "voice", connection: "connected" }));

    act(() => view.result.current.join("voice"));

    expect(fake().join).not.toHaveBeenCalled();
  });

  it("labels a private call with the caller's presentation", () => {
    const view = mount();

    act(() => view.result.current.join("dm", { label: "Ada", privateCall: true }));
    act(() => fake().set({ connection: "connected" }));

    expect(view.result.current.call).toMatchObject({
      channelId: "dm",
      channelName: "Ada",
      privateCall: true,
    });
    expect(view.result.current.privateCall).toBe(true);
    expect(view.result.current.soundboardEnabled).toBe(false);
  });

  it("names a public channel from the directory", () => {
    const view = mount();

    act(() => view.result.current.join("voice"));

    expect(view.result.current.call?.channelName).toBe("#voice");
    expect(view.result.current.privateCall).toBe(false);
    expect(view.result.current.soundboardEnabled).toBe(true);
  });

  it("clears deafen and the private label when leaving", async () => {
    const view = mount();
    act(() => view.result.current.join("dm", { label: "Ada", privateCall: true }));
    act(() => view.result.current.toggleDeafen());
    expect(view.result.current.call?.deafened).toBe(true);

    await act(() => view.result.current.leave());

    expect(fake().leave).toHaveBeenCalled();
    expect(fake().setDeafened).toHaveBeenLastCalledWith(false);
    expect(harness.ports.soundboard.setDeafened).toHaveBeenLastCalledWith(false);
    expect(view.result.current.call).toBeNull();
    expect(view.result.current.privateCall).toBe(false);
  });

  it("does nothing when asked to leave without a call", async () => {
    const view = mount();

    await act(() => view.result.current.leave());

    expect(fake().leave).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalled();
  });

  it("repairs the call through the client without leaving it", () => {
    const view = mount();
    act(() => view.result.current.join("ch-salon"));

    act(() => view.result.current.reconnect());

    expect(fake().reconnect).toHaveBeenCalledOnce();
    expect(fake().leave).not.toHaveBeenCalled();
  });
});

describe("VoiceProvider toggles", () => {
  it("mutes and unmutes with a sound for each", () => {
    const view = mount();

    act(() => view.result.current.toggleMute());
    expect(fake().setMuted).toHaveBeenLastCalledWith(true);
    expect(playSystemFx).toHaveBeenLastCalledWith("mute");

    act(() => view.result.current.toggleMute());
    expect(fake().setMuted).toHaveBeenLastCalledWith(false);
    expect(playSystemFx).toHaveBeenLastCalledWith("unmute");
  });

  it("deafens the client and the soundboard together", () => {
    const view = mount();

    act(() => view.result.current.toggleDeafen());

    expect(fake().setDeafened).toHaveBeenLastCalledWith(true);
    expect(harness.ports.soundboard.setDeafened).toHaveBeenLastCalledWith(true);
    expect(playSystemFx).toHaveBeenLastCalledWith("mute");
  });

  it("starts and stops a screen share", () => {
    const view = mount();

    act(() => view.result.current.toggleShare());
    expect(fake().startScreenShare).toHaveBeenCalledOnce();

    act(() => view.result.current.toggleShare());
    expect(fake().stopScreenShare).toHaveBeenCalledOnce();
  });

  it("leaves the camera alone where the browser cannot provide one", () => {
    const view = mount();

    act(() => view.result.current.toggleCamera());

    expect(fake().startCamera).not.toHaveBeenCalled();
  });

  it("starts and stops the camera where it is supported", () => {
    const view = mount();
    act(() => fake().set({ cameraSupported: true }));

    act(() => view.result.current.toggleCamera());
    expect(fake().startCamera).toHaveBeenCalledOnce();

    act(() => view.result.current.toggleCamera());
    expect(fake().stopCamera).toHaveBeenCalledOnce();
  });
});

describe("VoiceProvider soundboard and participant controls", () => {
  it("plays a clip into the joined channel only", () => {
    const view = mount();

    act(() => view.result.current.playSound("airhorn"));
    expect(harness.ports.soundboard.play).not.toHaveBeenCalled();

    act(() => fake().set({ channelId: "voice", connection: "connected" }));
    act(() => view.result.current.playSound("airhorn"));
    expect(harness.ports.soundboard.play).toHaveBeenCalledWith("airhorn", "voice");
  });

  it("disables the soundboard where the browser cannot play clips", () => {
    harness.soundboard = { ...SOUNDBOARD, supported: false };

    const view = mount();

    expect(view.result.current.soundboardEnabled).toBe(false);
  });

  it("forwards per-participant volume, gate and suppression to the client", () => {
    const view = mount();

    act(() => {
      view.result.current.setParticipantVolume("ada", 150);
      view.result.current.setParticipantGate("ada", true);
      view.result.current.setParticipantSuppression("ada", true);
    });

    expect(fake().setPeerVolume).toHaveBeenCalledWith("ada", 150);
    expect(fake().setPeerGate).toHaveBeenCalledWith("ada", true);
    expect(fake().setPeerSuppression).toHaveBeenCalledWith("ada", true);
  });
});

describe("VoiceProvider failures", () => {
  it("shapes a client failure into a problem and logs it once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = mount();

    act(() => fake().set({ error: { kind: "mic-denied", message: "NotAllowedError" } }));
    act(() => fake().set({ error: { kind: "mic-denied", message: "NotAllowedError" } }));

    expect(view.result.current.problem).toMatchObject({
      kind: "mic-denied",
      title: "voiceError.titleMic",
      message: "voiceError.micDenied",
      recoverable: false,
    });
    expect(view.result.current.error).toBe("voiceError.micDenied");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

describe("useVoiceContext", () => {
  it("refuses to run outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Reader />)).toThrow("useVoice must be used inside <VoiceProvider>");

    quiet.mockRestore();
  });
});

function Reader(): ReactNode {
  const voice: VoiceValue = useVoiceContext();
  return voice.channelId;
}
