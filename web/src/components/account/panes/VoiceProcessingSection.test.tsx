import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MicTest, VoiceSettings } from "@/ports";

import { VoiceProcessingSection } from "./VoiceProcessingSection";
import { idleMic, voiceSettings } from "./voiceTestFixtures";

function setup(options: { settings?: Partial<VoiceSettings>; mic?: Partial<MicTest> } = {}) {
  const onChange = vi.fn();
  const view = render(
    <VoiceProcessingSection
      settings={{ ...voiceSettings, ...options.settings }}
      onChange={onChange}
      mic={{ ...idleMic, ...options.mic }}
    />,
  );
  return { onChange, ...view };
}

describe("VoiceProcessingSection noise reduction", () => {
  it("offers the suppressors in order, with the chosen one's explanation under them", () => {
    setup({ settings: { noiseSuppression: "rnnoise" } });

    const names = screen
      .getAllByRole("radio")
      .map((radio) => radio.textContent);
    expect(names).toEqual(["Przeglądarki", "RNNoise", "GTCRN", "Speex", "Wyłączona"]);
    expect(screen.getByRole("radio", { name: "RNNoise" })).toBeChecked();
    expect(screen.getByText(/Sieć neuronowa działająca lokalnie/)).toBeInTheDocument();
  });

  it("requests the suppressor that was picked", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(screen.getByRole("radio", { name: "Speex" }));

    expect(onChange).toHaveBeenCalledWith({ noiseSuppression: "speex" });
  });

  it("does not claim a suppressor that failed to start", () => {
    setup({
      settings: { noiseSuppression: "rnnoise" },
      mic: { running: true, activeNoiseSuppression: "browser" },
    });

    expect(
      screen.getByText(
        "Wybrano „RNNoise”, ale mikrofon czyści teraz redukcja przeglądarki.",
      ),
    ).toBeInTheDocument();
  });

  it("says nothing was running when the request fell through to no suppressor", () => {
    setup({
      settings: { noiseSuppression: "gtcrn" },
      mic: { running: true, activeNoiseSuppression: "none" },
    });

    expect(
      screen.getByText(/mikrofon czyści teraz nic — surowy dźwięk z mikrofonu/),
    ).toBeInTheDocument();
  });

  it("stays quiet when the suppressor is the one that was asked for", () => {
    setup({
      settings: { noiseSuppression: "browser" },
      mic: { running: true, activeNoiseSuppression: "browser" },
    });

    expect(screen.queryByText(/mikrofon czyści teraz/)).toBeNull();
  });

  it("treats switching suppression off as asking for none", () => {
    setup({
      settings: { noiseSuppression: "off" },
      mic: { running: true, activeNoiseSuppression: "none" },
    });

    expect(screen.queryByText(/mikrofon czyści teraz/)).toBeNull();
  });

  it("stays quiet while no capture is open", () => {
    setup({ settings: { noiseSuppression: "rnnoise" }, mic: { activeNoiseSuppression: null } });

    expect(screen.queryByText(/mikrofon czyści teraz/)).toBeNull();
  });
});

describe("VoiceProcessingSection echo and volume", () => {
  it("toggles echo cancellation and automatic volume", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(screen.getByRole("button", { name: "Izolacja głosu i echa" }));
    expect(onChange).toHaveBeenLastCalledWith({ echoCancellation: false });

    await user.click(screen.getByRole("button", { name: "Automatyczna głośność" }));
    expect(onChange).toHaveBeenLastCalledWith({ autoGainControl: false });
  });

  it("says when the browser's automatic volume is the one running", () => {
    setup({ mic: { running: true, autoGain: "browser" } });

    expect(screen.getByText(/w wersji przeglądarki, która podbija też tło/)).toBeInTheDocument();
  });

  it("says when neither automatic volume is available", () => {
    setup({ mic: { running: true, autoGain: "none" } });

    expect(
      screen.getByText("Ta przeglądarka nie obsługuje automatycznej głośności."),
    ).toBeInTheDocument();
  });

  it("stays quiet about automatic volume when it is switched off or ours is running", () => {
    const { rerender } = setup({
      settings: { autoGainControl: false },
      mic: { running: true, autoGain: "none" },
    });
    expect(screen.queryByText(/automatycznej głośności\./)).toBeNull();

    rerender(
      <VoiceProcessingSection
        settings={voiceSettings}
        onChange={vi.fn()}
        mic={{ ...idleMic, running: true, autoGain: "worklet" }}
      />,
    );
    expect(screen.queryByText(/w wersji przeglądarki/)).toBeNull();
    expect(screen.queryByText(/nie obsługuje automatycznej/)).toBeNull();
  });
});

describe("VoiceProcessingSection reopening note", () => {
  it("warns that changes reopen the microphone only while the test holds it open", () => {
    const { rerender } = setup({ mic: { running: true } });
    expect(screen.getByText(/otwiera mikrofon na nowo/)).toBeInTheDocument();

    rerender(
      <VoiceProcessingSection settings={voiceSettings} onChange={vi.fn()} mic={idleMic} />,
    );
    expect(screen.queryByText(/otwiera mikrofon na nowo/)).toBeNull();
  });
});
