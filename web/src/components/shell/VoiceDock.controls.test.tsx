import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CallVM } from "@/components/view-models";

import { VoiceDock, type VoiceDockProps } from "./VoiceDock";

const CALL: CallVM = {
  channelId: "voice-1",
  channelName: "pogaduchy",
  startedAt: Date.now(),
  muted: false,
  deafened: false,
  cameraOn: false,
  cameraPending: false,
  sharing: false,
  latencyMs: 42,
  connectionQuality: "good",
  headline: "connected",
};

function props(overrides: Partial<VoiceDockProps> = {}): VoiceDockProps {
  return {
    call: CALL,
    sounds: [],
    soundboardVolume: 100,
    onChangeSoundboardVolume: vi.fn(),
    cameraSupported: true,
    noiseSuppression: "off",
    onChangeNoiseSuppression: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleDeafen: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleShare: vi.fn(),
    onLeave: vi.fn(),
    onPlaySound: vi.fn(),
    onReturnToChannel: vi.fn(),
    ...overrides,
  };
}

function call(overrides: Partial<CallVM>): CallVM {
  return { ...CALL, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("VoiceDock status", () => {
  it("stays out of sight and out of the way while there is no call", () => {
    const { container } = render(<VoiceDock {...props({ call: null })} />);

    expect(container.querySelector(".voice-dock")).toHaveClass("hidden");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts the time since the call started", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
    const startedAt = Date.now() - 65_000;
    render(<VoiceDock {...props({ call: call({ startedAt }) })} />);

    expect(screen.getByText("01:05")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("01:08")).toBeInTheDocument();
  });

  it("says which channel the call is in and what state it is in", () => {
    render(<VoiceDock {...props({ call: call({ headline: "reconnecting" }) })} />);

    expect(screen.getByText("Ponowne łączenie")).toBeInTheDocument();
    expect(screen.getByText("pogaduchy")).toBeInTheDocument();
  });

  it("shows no connection quality until the call is connected", () => {
    render(<VoiceDock {...props({ call: call({ headline: "connecting" }) })} />);

    expect(screen.queryByText(/Dobra/)).toBeNull();
  });

  it("reports a quality that is still being measured", () => {
    render(
      <VoiceDock
        {...props({ call: call({ connectionQuality: "unknown", latencyMs: null }) })}
      />,
    );

    expect(screen.getByText("Pomiar…")).toBeInTheDocument();
    expect(screen.getByLabelText("Trwa pomiar jakości połączenia.")).toBeInTheDocument();
  });
});

describe("VoiceDock return to the channel", () => {
  it("is a plain status line while only conversation is live", () => {
    const { container } = render(<VoiceDock {...props()} />);

    expect(container.querySelector(".dock-item")).not.toHaveAttribute("role");
    expect(screen.queryByTitle("Wróć do kanału")).toBeNull();
  });

  it("becomes a way back to the channel while the screen is shared", async () => {
    const user = userEvent.setup();
    const onReturnToChannel = vi.fn();
    render(
      <VoiceDock
        {...props({ call: call({ headline: "screen" }), onReturnToChannel })}
      />,
    );

    const back = screen.getByTitle("Wróć do kanału");
    expect(back).toHaveAttribute("role", "button");
    await user.click(back);
    back.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onReturnToChannel).toHaveBeenCalledTimes(3);
  });

  it("keeps the buttons inside the row from also leaving for the channel", async () => {
    const user = userEvent.setup();
    const onReturnToChannel = vi.fn();
    const onLeave = vi.fn();
    render(
      <VoiceDock
        {...props({ call: call({ headline: "screen" }), onReturnToChannel, onLeave })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rozłącz" }));

    expect(onLeave).toHaveBeenCalledOnce();
    expect(onReturnToChannel).not.toHaveBeenCalled();
  });
});

describe("VoiceDock controls", () => {
  it("toggles the microphone and the sound, and shows when each is off", async () => {
    const user = userEvent.setup();
    const p = props({ call: call({ muted: true, deafened: true }) });
    render(<VoiceDock {...p} />);

    const mic = screen.getByRole("button", { name: "Mikrofon" });
    const sound = screen.getByRole("button", { name: "Wycisz dźwięk" });
    expect(mic).toHaveAttribute("aria-pressed", "true");
    expect(mic).toHaveAttribute("title", "Wyłącz wyciszenie");
    expect(sound).toHaveAttribute("aria-pressed", "true");
    expect(sound).toHaveAttribute("title", "Włącz dźwięk");
    await user.click(mic);
    await user.click(sound);

    expect(p.onToggleMute).toHaveBeenCalledOnce();
    expect(p.onToggleDeafen).toHaveBeenCalledOnce();
  });

  it("starts and stops screen sharing", async () => {
    const user = userEvent.setup();
    const p = props({ call: call({ sharing: true }) });
    render(<VoiceDock {...p} />);

    const share = screen.getByRole("button", { name: "Udostępnij ekran" });
    expect(share).toHaveAttribute("aria-pressed", "true");
    expect(share).toHaveAttribute("title", "Zakończ udostępnianie");
    await user.click(share);

    expect(p.onToggleShare).toHaveBeenCalledOnce();
  });

  it("toggles the camera when the browser has one", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<VoiceDock {...p} />);

    await user.click(screen.getByRole("button", { name: "Włącz kamerę" }));

    expect(p.onToggleCamera).toHaveBeenCalledOnce();
  });

  it("disables the camera and says why when the browser has none", () => {
    render(<VoiceDock {...props({ cameraSupported: false })} />);

    const camera = screen.getByRole("button", { name: "Włącz kamerę" });
    expect(camera).toBeDisabled();
    expect(camera).toHaveAttribute(
      "title",
      "Ta przeglądarka nie udostępnia kamery dla rozmów.",
    );
  });

  it("marks the camera busy while it starts", () => {
    render(<VoiceDock {...props({ call: call({ cameraPending: true }) })} />);

    const camera = screen.getByRole("button", { name: "Włączam kamerę" });
    expect(camera).toBeDisabled();
    expect(camera).toHaveAttribute("aria-busy", "true");
  });

  it("opens the soundboard from the dock", async () => {
    const user = userEvent.setup();
    render(<VoiceDock {...props()} />);

    const board = screen.getByRole("button", { name: "Soundboard" });
    expect(board).toHaveAttribute("aria-expanded", "false");
    await user.click(board);

    expect(board).toHaveAttribute("aria-expanded", "true");
  });
});
