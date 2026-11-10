import { afterEach, describe, expect, it, vi } from "vitest";

import { CallMediaSessionController } from "./mediaSession";

class TestMediaMetadata {
  constructor(readonly init: MediaMetadataInit) {}
}

function installMediaSession() {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const session = {
    metadata: null as MediaMetadata | null,
    playbackState: "none" as MediaSessionPlaybackState,
    setActionHandler: vi.fn((action: string, handler: MediaSessionActionHandler | null) => {
      handlers.set(action, handler);
    }),
    setMicrophoneActive: vi.fn(async () => undefined),
    setCameraActive: vi.fn(async () => undefined),
    setPositionState: vi.fn(),
  };
  Object.defineProperty(navigator, "mediaSession", {
    value: session,
    configurable: true,
  });
  Object.defineProperty(globalThis, "MediaMetadata", {
    value: TestMediaMetadata,
    configurable: true,
  });
  return { session, handlers };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaSession");
  Reflect.deleteProperty(globalThis, "MediaMetadata");
});

describe("CallMediaSessionController", () => {
  it("publishes a live call and wires lock-screen actions", () => {
    const { session, handlers } = installMediaSession();
    const toggle = vi.fn();
    const hangup = vi.fn();
    const controller = new CallMediaSessionController();

    controller.sync({
      title: "Salon",
      subtitle: "Rozmowa głosowa",
      muted: false,
      cameraActive: true,
      onToggleMute: toggle,
      onHangup: hangup,
    });

    expect(session.playbackState).toBe("playing");
    expect((session.metadata as unknown as TestMediaMetadata).init).toMatchObject({
      title: "Salon",
      artist: "Rozmowa głosowa",
    });
    expect(session.setMicrophoneActive).toHaveBeenCalledWith(true);
    expect(session.setCameraActive).toHaveBeenCalledWith(true);

    handlers.get("togglemicrophone")?.({ action: "stop" });
    handlers.get("hangup")?.({ action: "stop" });
    expect(toggle).toHaveBeenCalledOnce();
    expect(hangup).toHaveBeenCalledOnce();
  });

  it("clears system state after leaving the room", () => {
    const { session } = installMediaSession();
    const controller = new CallMediaSessionController();
    controller.sync({
      title: "Salon",
      subtitle: "Voice call",
      muted: true,
      cameraActive: false,
      onToggleMute: vi.fn(),
      onHangup: vi.fn(),
    });

    controller.sync(null);

    expect(session.playbackState).toBe("none");
    expect(session.metadata).toBeNull();
    expect(session.setActionHandler).toHaveBeenCalledWith("togglemicrophone", null);
    expect(session.setActionHandler).toHaveBeenCalledWith("hangup", null);
  });

  it("keeps the call alive when conferencing actions are unsupported", () => {
    const { session } = installMediaSession();
    session.setActionHandler.mockImplementation(() => {
      throw new DOMException("Unsupported", "NotSupportedError");
    });
    const controller = new CallMediaSessionController();

    expect(() => controller.sync({
      title: "Salon",
      subtitle: "Voice call",
      muted: false,
      cameraActive: false,
      onToggleMute: vi.fn(),
      onHangup: vi.fn(),
    })).not.toThrow();
    expect(session.playbackState).toBe("playing");
  });
});
