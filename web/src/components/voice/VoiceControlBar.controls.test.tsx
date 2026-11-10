import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Sound, VoiceSettings } from "@/ports";

import { VoiceControlBar, type VoiceControlBarProps } from "./VoiceControlBar";

const settings: VoiceSettings = {
  version: 1,
  inputDeviceId: null,
  outputDeviceId: null,
  outputVolume: 100,
  soundboardVolume: 80,
  playbackProfile: "studio",
  playbackTuning: {
    warmthDb: 3.5,
    mudDb: -4.5,
    presenceDb: 5,
    airDb: 3,
    compression: 65,
  },
  videoDeviceId: null,
  cameraQuality: "balanced",
  opusProfile: "premium",
  screenShareQuality: "balanced",
  noiseSuppression: "browser",
  echoCancellation: true,
  autoGainControl: true,
  vadSensitivity: 60,
  inputGainDb: 0,
  inputGate: true,
};

const drum: Sound = {
  id: "drum",
  name: "Bęben",
  glyph: "🥁",
  url: "/assets/drum",
  durationSeconds: 1,
  trimStartSeconds: 0,
  trimEndSeconds: 1,
};

function props(overrides: Partial<VoiceControlBarProps> = {}): VoiceControlBarProps {
  return {
    muted: false,
    cameraOn: false,
    sharing: false,
    cinema: false,
    sounds: [],
    settings,
    onChangeSettings: vi.fn(),
    cameraSupported: true,
    onToggleMute: vi.fn(),
    onToggleCamera: vi.fn(),
    onSelectMicrophone: vi.fn(),
    onSelectCamera: vi.fn(),
    onToggleShare: vi.fn(),
    onPlaySound: vi.fn(),
    onToggleCinema: vi.fn(),
    onLeave: vi.fn(),
    onPopOut: vi.fn(),
    ...overrides,
  };
}

const compactMenu = () => document.querySelector<HTMLElement>(".vc-mobile-menu")!;

describe("VoiceControlBar full screen", () => {
  let current: Element | null = null;
  const exitFullscreen = vi.fn();
  const requestFullscreen = vi.fn(() => Promise.resolve());
  const target = document.createElement("div");
  target.requestFullscreen = requestFullscreen;

  /** jsdom has no Fullscreen API, so the browser's side of it is played here. */
  function setFullscreenElement(element: Element | null) {
    current = element;
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
  }

  function startIn(element: Element | null) {
    current = element;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    document.exitFullscreen = exitFullscreen;
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
    exitFullscreen.mockClear();
    requestFullscreen.mockClear();
  });

  it("asks the browser to put the target element into full screen", async () => {
    const user = userEvent.setup();
    startIn(null);
    render(<VoiceControlBar {...props({ fullscreenTarget: () => target })} />);

    await user.click(screen.getByRole("button", { name: "Pełny ekran" }));

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("leaves full screen through the document when it is already on", async () => {
    const user = userEvent.setup();
    startIn(target);
    render(<VoiceControlBar {...props({ fullscreenTarget: () => target })} />);

    const button = screen.getByRole("button", { name: "Wyjdź z pełnego ekranu (Esc)" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);

    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("follows the browser when full screen is left without the button", () => {
    startIn(target);
    render(<VoiceControlBar {...props({ fullscreenTarget: () => target })} />);
    expect(screen.getByRole("button", { name: "Wyjdź z pełnego ekranu (Esc)" })).toBeVisible();

    setFullscreenElement(null);

    const button = screen.getByRole("button", { name: "Pełny ekran" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("does nothing when there is no element to show", async () => {
    const user = userEvent.setup();
    startIn(null);
    render(<VoiceControlBar {...props({ fullscreenTarget: () => null })} />);

    await user.click(screen.getByRole("button", { name: "Pełny ekran" }));

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pełny ekran" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("offers the same toggle in the compact menu and closes the menu after it", async () => {
    const user = userEvent.setup();
    startIn(null);
    render(<VoiceControlBar {...props({ fullscreenTarget: () => target })} />);

    await user.click(screen.getByRole("button", { name: "Więcej opcji rozmowy" }));
    await user.click(within(compactMenu()).getByRole("button", { name: "Pełny ekran" }));

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(compactMenu()).toHaveAttribute("hidden");
  });
});

describe("VoiceControlBar buttons", () => {
  it("shows the mute state on the microphone button and toggles it", async () => {
    const user = userEvent.setup();
    const onToggleMute = vi.fn();
    render(<VoiceControlBar {...props({ muted: true, onToggleMute })} />);

    const button = screen.getByRole("button", { name: "Mikrofon" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Wyłącz wyciszenie");
    await user.click(button);
    expect(onToggleMute).toHaveBeenCalledOnce();
  });

  it("keeps the camera button off while it starts or when the browser has none", () => {
    const { rerender } = render(<VoiceControlBar {...props({ cameraPending: true })} />);
    const starting = screen.getByRole("button", { name: "Włączam kamerę" });
    expect(starting).toBeDisabled();
    expect(starting).toHaveAttribute("aria-busy", "true");

    rerender(<VoiceControlBar {...props({ cameraSupported: false })} />);
    expect(screen.getByRole("button", { name: "Włącz kamerę" })).toBeDisabled();
  });

  it("explains in the camera drawer that this browser has no camera", async () => {
    const user = userEvent.setup();
    render(<VoiceControlBar {...props({ cameraSupported: false })} />);

    await user.click(screen.getByRole("button", { name: "Jakość i ustawienia kamery" }));

    expect(screen.getByText("Niedostępna w tej przeglądarce")).toBeVisible();
    expect(screen.getByText("Ta przeglądarka nie udostępnia kamery dla rozmów.")).toBeVisible();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("announces the cinema toggle by its state", async () => {
    const user = userEvent.setup();
    const onToggleCinema = vi.fn();
    render(<VoiceControlBar {...props({ cinema: true, onToggleCinema })} />);

    const button = screen.getByRole("button", { name: "Wyjdź z trybu kinowego (Esc)" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(onToggleCinema).toHaveBeenCalledOnce();
  });
});

describe("VoiceControlBar drawers", () => {
  it("keeps one drawer open at a time", async () => {
    const user = userEvent.setup();
    render(<VoiceControlBar {...props()} />);
    const drawers = () => document.querySelectorAll<HTMLElement>(".vc-menu:not([hidden])");

    await user.click(screen.getByRole("button", { name: "Jakość i ustawienia mikrofonu" }));
    expect(drawers()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Jakość i ustawienia kamery" }));
    expect(drawers()).toHaveLength(1);
    expect(drawers()[0]).toHaveTextContent("Jakość obrazu");
  });

  it("closes the drawer before sending the person to the full settings", async () => {
    const user = userEvent.setup();
    const onSelectMicrophone = vi.fn();
    render(<VoiceControlBar {...props({ onSelectMicrophone })} />);
    const caret = screen.getByRole("button", { name: "Jakość i ustawienia mikrofonu" });

    await user.click(caret);
    await user.click(screen.getByRole("button", { name: "Więcej ustawień dźwięku" }));

    expect(onSelectMicrophone).toHaveBeenCalledOnce();
    expect(caret).toHaveAttribute("aria-expanded", "false");
  });

  it("closes a drawer from the arrow that opened it", async () => {
    const user = userEvent.setup();
    render(<VoiceControlBar {...props()} />);
    const caret = screen.getByRole("button", { name: "Jakość i ustawienia mikrofonu" });

    await user.click(caret);
    expect(caret).toHaveAttribute("aria-expanded", "true");
    await user.click(caret);
    expect(caret).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the profile in force", async () => {
    const user = userEvent.setup();
    render(<VoiceControlBar {...props()} />);

    await user.click(screen.getByRole("button", { name: "Jakość i ustawienia mikrofonu" }));

    expect(screen.getByRole("radio", { name: /Premium/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Studio/ })).not.toBeChecked();
  });
});

describe("VoiceControlBar compact menu", () => {
  it("closes an open drawer when it opens", async () => {
    const user = userEvent.setup();
    render(<VoiceControlBar {...props()} />);
    const caret = screen.getByRole("button", { name: "Jakość i ustawienia mikrofonu" });

    await user.click(caret);
    await user.click(screen.getByRole("button", { name: "Więcej opcji rozmowy" }));

    expect(caret).toHaveAttribute("aria-expanded", "false");
    expect(compactMenu()).not.toHaveAttribute("hidden");
  });

  it("plays sounds and sets their volume in its own soundboard view", async () => {
    const user = userEvent.setup();
    const onPlaySound = vi.fn();
    const onChangeSettings = vi.fn();
    render(<VoiceControlBar {...props({ sounds: [drum], onPlaySound, onChangeSettings })} />);

    await user.click(screen.getByRole("button", { name: "Więcej opcji rozmowy" }));
    await user.click(within(compactMenu()).getByRole("button", { name: "Soundboard" }));

    const view = within(compactMenu());
    await user.click(view.getByRole("button", { name: "Bęben" }));
    expect(onPlaySound).toHaveBeenCalledWith("drum");
    expect(compactMenu()).not.toHaveAttribute("hidden");

    fireEvent.change(view.getByRole("slider", { name: "Głośność soundboardu" }), {
      target: { value: "30" },
    });
    expect(onChangeSettings).toHaveBeenCalledWith({ soundboardVolume: 30 });
  });

  it("goes back to the actions, and starts there again after closing", async () => {
    const user = userEvent.setup();
    render(<VoiceControlBar {...props({ sounds: [drum] })} />);
    const more = screen.getByRole("button", { name: "Więcej opcji rozmowy" });

    await user.click(more);
    await user.click(within(compactMenu()).getByRole("button", { name: "Soundboard" }));
    await user.click(
      within(compactMenu()).getByRole("button", { name: "Wróć do opcji rozmowy" }),
    );
    expect(within(compactMenu()).getByRole("button", { name: "Soundboard" })).toBeVisible();

    await user.click(within(compactMenu()).getByRole("button", { name: "Soundboard" }));
    await user.click(more);
    await user.click(more);
    expect(within(compactMenu()).getByRole("button", { name: "Soundboard" })).toBeVisible();
  });

  it("offers the invitation only to those who may send one", async () => {
    const user = userEvent.setup();
    const onInvite = vi.fn();
    const { rerender } = render(<VoiceControlBar {...props({ onInvite })} />);

    await user.click(screen.getByRole("button", { name: "Więcej opcji rozmowy" }));
    await user.click(within(compactMenu()).getByRole("button", { name: "Zaproś osobę" }));
    expect(onInvite).toHaveBeenCalledOnce();

    rerender(<VoiceControlBar {...props()} />);
    await user.click(screen.getByRole("button", { name: "Więcej opcji rozmowy" }));
    expect(within(compactMenu()).queryByRole("button", { name: "Zaproś osobę" })).toBeNull();
  });
});
