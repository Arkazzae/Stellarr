import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { VoiceSettings } from "@/ports";

import { VoiceControlBar, type VoiceControlBarProps } from "./VoiceControlBar";

const settings: VoiceSettings = {
  version: 1,
  inputDeviceId: null,
  outputDeviceId: null,
  outputVolume: 100,
  soundboardVolume: 100,
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

function props(
  overrides: Partial<VoiceControlBarProps> = {},
): VoiceControlBarProps {
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
    onInvite: vi.fn(),
    onToggleCinema: vi.fn(),
    onLeave: vi.fn(),
    onPopOut: vi.fn(),
    ...overrides,
  };
}

describe("VoiceControlBar quality drawers", () => {
  it("hides invitation actions without server-management permission", () => {
    render(<VoiceControlBar {...props({ onInvite: undefined })} />);

    expect(
      screen.queryByRole("button", { name: "Zaproś na kanał" }),
    ).toBeNull();
  });

  it("keeps secondary call actions available through the compact menu", async () => {
    const user = userEvent.setup();
    const onToggleShare = vi.fn();
    render(<VoiceControlBar {...props({ onToggleShare })} />);

    await user.click(
      screen.getByRole("button", { name: "Więcej opcji rozmowy" }),
    );

    const menu = document.querySelector<HTMLElement>(".vc-mobile-menu");
    expect(menu).not.toBeNull();
    expect(menu).not.toHaveAttribute("hidden");

    await user.click(
      within(menu!).getByRole("button", { name: "Udostępnij ekran" }),
    );
    expect(onToggleShare).toHaveBeenCalledOnce();
    expect(menu).toHaveAttribute("hidden");
  });

  it("changes microphone, camera and screen quality from their arrow drawers", async () => {
    const user = userEvent.setup();
    const onChangeSettings = vi.fn();
    render(<VoiceControlBar {...props({ onChangeSettings })} />);

    await user.click(
      screen.getByRole("button", { name: "Jakość i ustawienia mikrofonu" }),
    );
    expect(screen.getByText("Premium · 128 kb/s")).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Jakość dźwięku" }),
    ).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Wyrazisty/ }));
    expect(onChangeSettings).toHaveBeenCalledWith({ opusProfile: "clarity" });

    await user.click(
      screen.getByRole("button", { name: "Jakość i ustawienia kamery" }),
    );
    expect(screen.getByText("Zrównoważona · 720p · 30 kl./s")).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Jakość obrazu" }),
    ).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Wyraźna/ }));
    expect(onChangeSettings).toHaveBeenCalledWith({ cameraQuality: "sharp" });

    await user.click(
      screen.getByRole("button", {
        name: "Jakość udostępniania ekranu",
      }),
    );
    expect(screen.getByText("Zrównoważona · 1080p · 30 kl./s")).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Profil wysyłania" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /Wyraźna/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Ultra/ })).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: /Ultra/ }));
    expect(onChangeSettings).toHaveBeenCalledWith({
      screenShareQuality: "ultra",
    });
  });
});
