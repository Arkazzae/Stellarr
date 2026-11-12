import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MicTest, VoiceSettings } from "@/ports";

import { VoiceMicrophoneSection } from "./VoiceMicrophoneSection";
import { idleMic, voiceSettings } from "./voiceTestFixtures";

function setup(options: { settings?: Partial<VoiceSettings>; mic?: Partial<MicTest> } = {}) {
  const onChange = vi.fn();
  const onVadCommit = vi.fn();
  const view = render(
    <VoiceMicrophoneSection
      settings={{ ...voiceSettings, ...options.settings }}
      onChange={onChange}
      onVadCommit={onVadCommit}
      mic={{ ...idleMic, ...options.mic }}
    />,
  );
  return { onChange, onVadCommit, ...view };
}

describe("VoiceMicrophoneSection device", () => {
  it("stores a chosen microphone by id and the system default as null", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const select = screen.getByLabelText("Mikrofon");

    await user.selectOptions(select, "mic-1");
    expect(onChange).toHaveBeenLastCalledWith({ inputDeviceId: "mic-1" });

    await user.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith({ inputDeviceId: null });
  });

  it("shows the chosen microphone as selected", () => {
    setup({ settings: { inputDeviceId: "mic-1" } });

    expect(screen.getByLabelText("Mikrofon")).toHaveValue("mic-1");
  });

  it("explains unnamed devices only until permission has been granted", () => {
    const { rerender } = setup({ mic: { labelsKnown: false } });
    expect(screen.getByText(/Nazwy mikrofonów pokażą się/)).toBeInTheDocument();

    rerender(
      <VoiceMicrophoneSection
        settings={voiceSettings}
        onChange={vi.fn()}
        onVadCommit={vi.fn()}
        mic={idleMic}
      />,
    );
    expect(screen.queryByText(/Nazwy mikrofonów pokażą się/)).toBeNull();
  });

  it("names the microphone the system default resolved to, and only for the default", () => {
    const { rerender } = setup({ mic: { running: true, activeDeviceLabel: "Blue Yeti" } });
    expect(screen.getByText("Teraz to: Blue Yeti")).toBeInTheDocument();

    rerender(
      <VoiceMicrophoneSection
        settings={{ ...voiceSettings, inputDeviceId: "mic-1" }}
        onChange={vi.fn()}
        onVadCommit={vi.fn()}
        mic={{ ...idleMic, running: true, activeDeviceLabel: "Blue Yeti" }}
      />,
    );
    expect(screen.queryByText(/Teraz to/)).toBeNull();
  });
});

describe("VoiceMicrophoneSection test", () => {
  it("starts the check from the button, and stops it while it runs", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const stop = vi.fn();
    const { rerender } = setup({ mic: { start, stop } });

    await user.click(screen.getByRole("button", { name: "Sprawdź mikrofon" }));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByText("Test wyłączony.")).toBeInTheDocument();

    rerender(
      <VoiceMicrophoneSection
        settings={voiceSettings}
        onChange={vi.fn()}
        onVadCommit={vi.fn()}
        mic={{ ...idleMic, running: true, start, stop }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Zatrzymaj" }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("cannot be clicked twice while the microphone is opening", () => {
    setup({ mic: { starting: true } });

    expect(screen.getByRole("button", { name: "Otwieram…" })).toBeDisabled();
  });

  it("reads the level and the detector's verdict off the meter", () => {
    const { rerender } = setup({
      mic: { running: true, speaking: true, level: 0.75, peak: 0.9 },
    });
    expect(screen.getByRole("meter", { name: "Poziom mikrofonu" })).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(screen.getByText(/To trafiłoby do rozmowy/)).toBeInTheDocument();

    rerender(
      <VoiceMicrophoneSection
        settings={voiceSettings}
        onChange={vi.fn()}
        onVadCommit={vi.fn()}
        mic={{ ...idleMic, running: true, speaking: false, level: 0.1 }}
      />,
    );
    expect(screen.getByText(/To zostałoby uznane za tło/)).toBeInTheDocument();
  });

  it("shows the failure with a retry in place of the status line", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    setup({ mic: { error: "Brak zgody na mikrofon.", start } });

    expect(screen.getByText("Brak zgody na mikrofon.")).toBeInTheDocument();
    expect(screen.queryByText("Test wyłączony.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(start).toHaveBeenCalledOnce();
  });
});

describe("VoiceMicrophoneSection levels", () => {
  it("applies sensitivity on every step and saves it when the adjustment ends", () => {
    const { onChange, onVadCommit } = setup();
    const slider = screen.getByLabelText(/Czułość wykrywania mowy/);

    fireEvent.change(slider, { target: { value: "75" } });
    expect(onChange).toHaveBeenCalledWith({ vadSensitivity: 75 });
    expect(onVadCommit).not.toHaveBeenCalled();

    // The parent has not re-rendered with 75 yet, so the release has to know
    // what was dragged to rather than read it back from the settings.
    fireEvent.pointerUp(slider);
    expect(onVadCommit).toHaveBeenLastCalledWith(75);
  });

  it("saves sensitivity after a keyboard adjustment and when focus leaves", () => {
    const { onVadCommit } = setup();
    const slider = screen.getByLabelText(/Czułość wykrywania mowy/);

    fireEvent.change(slider, { target: { value: "35" } });
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    expect(onVadCommit).toHaveBeenLastCalledWith(35);

    fireEvent.change(slider, { target: { value: "30" } });
    fireEvent.blur(slider);
    expect(onVadCommit).toHaveBeenLastCalledWith(30);
  });

  it("saves the value the settings were changed to from outside", () => {
    const { onVadCommit, rerender } = setup();

    rerender(
      <VoiceMicrophoneSection
        settings={{ ...voiceSettings, vadSensitivity: 40 }}
        onChange={vi.fn()}
        onVadCommit={onVadCommit}
        mic={idleMic}
      />,
    );
    fireEvent.pointerUp(screen.getByLabelText(/Czułość wykrywania mowy/));

    expect(onVadCommit).toHaveBeenLastCalledWith(40);
  });

  it("changes the input gain in decibels and shows it signed", () => {
    const { onChange } = setup({ settings: { inputGainDb: 6 } });
    const gain = screen.getByLabelText(/Wzmocnienie mikrofonu/);

    expect(screen.getByText("+6 dB")).toBeInTheDocument();
    fireEvent.change(gain, { target: { value: "-3" } });
    expect(onChange).toHaveBeenCalledWith({ inputGainDb: -3 });
  });

  it("switches the gate off and on", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(screen.getByRole("button", { name: "Bramka mikrofonu" }));

    expect(onChange).toHaveBeenCalledWith({ inputGate: false });
  });

  it("admits that the gate could not be built, but only while it is switched on", () => {
    const { rerender } = setup({ mic: { running: true, gateActive: false } });
    expect(screen.getByText(/nie obsługuje bramki mikrofonu/)).toBeInTheDocument();

    rerender(
      <VoiceMicrophoneSection
        settings={{ ...voiceSettings, inputGate: false }}
        onChange={vi.fn()}
        onVadCommit={vi.fn()}
        mic={{ ...idleMic, running: true, gateActive: false }}
      />,
    );
    expect(screen.queryByText(/nie obsługuje bramki mikrofonu/)).toBeNull();

    rerender(
      <VoiceMicrophoneSection
        settings={voiceSettings}
        onChange={vi.fn()}
        onVadCommit={vi.fn()}
        mic={{ ...idleMic, running: true, gateActive: true }}
      />,
    );
    expect(screen.queryByText(/nie obsługuje bramki mikrofonu/)).toBeNull();
  });
});
