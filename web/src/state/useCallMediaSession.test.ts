import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCallMediaSession } from "./useCallMediaSession";

type Handler = (() => void) | null;

const handlers = new Map<string, Handler>();
const session = {
  setActionHandler: vi.fn((action: string, handler: Handler) => {
    handlers.set(action, handler);
  }),
  setMicrophoneActive: vi.fn(),
  setCameraActive: vi.fn(),
  playbackState: "none",
  metadata: null,
};

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaSession");
});

function mount(title: string | null, onHangup = vi.fn(), onToggleMute = vi.fn()) {
  const view = renderHook(
    (props: { title: string | null; muted: boolean }) =>
      useCallMediaSession({
        title: props.title,
        subtitle: "Voice channel",
        muted: props.muted,
        cameraActive: false,
        onToggleMute,
        onHangup,
      }),
    { initialProps: { title, muted: false } },
  );
  return { view, onHangup, onToggleMute };
}

describe("useCallMediaSession", () => {
  it("routes the system hang-up and mute controls to the call", () => {
    const { onHangup, onToggleMute } = mount("Lounge");

    handlers.get("hangup")?.();
    handlers.get("togglemicrophone")?.();

    expect(onHangup).toHaveBeenCalledOnce();
    expect(onToggleMute).toHaveBeenCalledOnce();
  });

  it("reports the microphone as active while unmuted", () => {
    const { view } = mount("Lounge");
    expect(session.setMicrophoneActive).toHaveBeenLastCalledWith(true);

    view.rerender({ title: "Lounge", muted: true });

    expect(session.setMicrophoneActive).toHaveBeenLastCalledWith(false);
  });

  it("publishes nothing when there is no call", () => {
    mount(null);

    expect(handlers.size).toBe(0);
  });

  it("withdraws the controls when the call ends", () => {
    const { view } = mount("Lounge");

    view.rerender({ title: null, muted: false });

    expect(handlers.get("hangup")).toBeNull();
    expect(handlers.get("togglemicrophone")).toBeNull();
  });

  it("withdraws the controls when the provider unmounts", () => {
    const { view } = mount("Lounge");

    view.unmount();

    expect(handlers.get("hangup")).toBeNull();
  });
});
