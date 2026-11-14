import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OutputTest, VoiceSettings } from "@/ports";

import { SpeakerCheck, VoicePlaybackSection } from "./VoicePlaybackSection";
import { idleOutput, voiceSettings } from "./voiceTestFixtures";

function setup(options: { settings?: Partial<VoiceSettings>; output?: Partial<OutputTest> } = {}) {
  const onChange = vi.fn();
  const view = render(
    <VoicePlaybackSection
      settings={{ ...voiceSettings, ...options.settings }}
      onChange={onChange}
      output={{ ...idleOutput, ...options.output }}
    />,
  );
  return { onChange, ...view };
}

/** The speaker test now stands in the pane's check panel, apart from the rows. */
function setupCheck(options: { output?: Partial<OutputTest> } = {}) {
  return render(<SpeakerCheck output={{ ...idleOutput, ...options.output }} />);
}

const profiles = () => screen.getByRole("radiogroup", { name: "Brzmienie rozmowy" });

describe("VoicePlaybackSection output", () => {
  it("routes playback to a chosen speaker, and back to the system default as null", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const select = screen.getByLabelText("Urządzenie wyjściowe");

    await user.selectOptions(select, "speaker-1");
    expect(onChange).toHaveBeenLastCalledWith({ outputDeviceId: "speaker-1" });

    await user.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith({ outputDeviceId: null });
  });

  it("locks the choice to the system when the browser cannot route output", () => {
    setup({ output: { deviceSelectionSupported: false } });

    expect(screen.getByLabelText("Urządzenie wyjściowe")).toBeDisabled();
    expect(screen.getByText(/pozwala zmienić wyjście tylko w ustawieniach systemu/)).toBeInTheDocument();
    expect(screen.queryByText(/Nazwy głośników mogą pojawić się/)).toBeNull();
  });

  it("explains unnamed speakers only where choosing one is possible", () => {
    setup({ output: { labelsKnown: false } });

    expect(screen.getByText(/Nazwy głośników mogą pojawić się/)).toBeInTheDocument();
  });

  it("changes the call volume in steps and shows it as a percentage", () => {
    const { onChange } = setup({ settings: { outputVolume: 40 } });

    expect(screen.getByText("40%")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Głośność odtwarzania"), {
      target: { value: "55" },
    });
    expect(onChange).toHaveBeenCalledWith({ outputVolume: 55 });
  });
});

describe("VoicePlaybackSection speaker test", () => {
  it("plays the clip, and stops it while it plays", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const stop = vi.fn();
    const { rerender } = setupCheck({ output: { start, stop } });

    expect(screen.getByText("Test gotowy.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Odtwórz dźwięk" }));
    expect(start).toHaveBeenCalledOnce();

    rerender(
      <SpeakerCheck output={{ ...idleOutput, playing: true, start, stop }} />,
    );
    expect(screen.getByText(/Odtwarzam nagranie w pętli/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zatrzymaj dźwięk" }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("shows a failure with a retry instead of the status line", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    setupCheck({ output: { error: "Nie udało się otworzyć głośników.", start } });

    expect(screen.getByText("Nie udało się otworzyć głośników.")).toBeInTheDocument();
    expect(screen.queryByText("Test gotowy.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(start).toHaveBeenCalledOnce();
  });
});

describe("VoicePlaybackSection sound profile", () => {
  it("adopts the curve of a preset when it is chosen", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(within(profiles()).getByRole("radio", { name: /^Wyłączone/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      playbackProfile: "off",
      playbackTuning: { warmthDb: 0, mudDb: 0, presenceDb: 0, airDb: 0, compression: 0 },
    });

    await user.click(within(profiles()).getByRole("radio", { name: /Broadcast/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      playbackProfile: "broadcast",
      playbackTuning: { warmthDb: 6, mudDb: -6, presenceDb: 4, airDb: 2, compression: 90 },
    });
  });

  it("keeps the current curve when the custom rung is chosen", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(within(profiles()).getByRole("radio", { name: /Własne/ }));

    expect(onChange).toHaveBeenLastCalledWith({
      playbackProfile: "custom",
      playbackTuning: voiceSettings.playbackTuning,
    });
  });

  it("explains the profile in use under the row", () => {
    setup({ settings: { playbackProfile: "natural" } });

    expect(screen.getByText("Lekka korekcja i subtelne wyrównanie poziomu.")).toBeInTheDocument();
  });
});

describe("VoicePlaybackSection equaliser", () => {
  it("hides the bands while a preset is in use", () => {
    setup();

    expect(screen.queryByRole("group", { name: "Equalizer i dynamika" })).toBeNull();
    expect(screen.queryByLabelText(/^Ciepło/)).toBeNull();
  });

  it("opens the bands on the custom rung, at the curve the last preset left", () => {
    setup({ settings: { playbackProfile: "custom" } });

    expect(screen.getByLabelText(/^Ciepło/)).toHaveValue("3.5");
    expect(screen.getByLabelText(/^Niższy środek/)).toHaveValue("-4.5");
    expect(screen.getByLabelText(/^Czytelność/)).toHaveValue("5");
    expect(screen.getByLabelText(/^Powietrze/)).toHaveValue("3");
    expect(screen.getByLabelText(/^Kompresja/)).toHaveValue("65");
  });

  it("writes one band into the custom curve and leaves the others alone", () => {
    const { onChange } = setup({ settings: { playbackProfile: "custom" } });

    fireEvent.change(screen.getByLabelText(/^Ciepło/), { target: { value: "-1.5" } });

    expect(onChange).toHaveBeenCalledWith({
      playbackProfile: "custom",
      playbackTuning: { ...voiceSettings.playbackTuning, warmthDb: -1.5 },
    });
  });

  it("writes compression as a percentage in steps of five", () => {
    const { onChange } = setup({ settings: { playbackProfile: "custom" } });

    expect(screen.getByText("65%", { selector: "output" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Kompresja/), { target: { value: "70" } });

    expect(onChange).toHaveBeenCalledWith({
      playbackProfile: "custom",
      playbackTuning: { ...voiceSettings.playbackTuning, compression: 70 },
    });
  });

  it("shows each band signed in decibels", () => {
    setup({ settings: { playbackProfile: "custom" } });

    const group = screen.getByRole("group", { name: "Equalizer i dynamika" });
    expect(within(group).getByText("+3.5 dB")).toBeInTheDocument();
    expect(within(group).getByText("-4.5 dB")).toBeInTheDocument();
  });
});
