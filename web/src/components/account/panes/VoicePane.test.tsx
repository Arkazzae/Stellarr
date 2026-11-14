import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VoicePane, type VoicePaneProps } from "./VoicePane";
import { idleCamera, idleMic, idleOutput, voiceSettings } from "./voiceTestFixtures";

function setup(overrides: Partial<VoicePaneProps> = {}) {
  const props: VoicePaneProps = {
    settings: voiceSettings,
    onChange: vi.fn(),
    onVadCommit: vi.fn(),
    onReset: vi.fn(),
    mic: idleMic,
    output: idleOutput,
    camera: idleCamera,
    ...overrides,
  };
  render(<VoicePane {...props} />);
  return props;
}

describe("VoicePane", () => {
  it("lays out what you send, then what you hear, then the checks with the picture last", () => {
    setup();

    const controls = [
      screen.getByLabelText("Mikrofon"),
      screen.getByRole("radiogroup", { name: "Redukcja szumu" }),
      screen.getByRole("slider", { name: /Jakość dźwięku/ }),
      screen.getByLabelText("Urządzenie wyjściowe"),
      screen.getByRole("radiogroup", { name: "Brzmienie rozmowy" }),
      screen.getByRole("button", { name: "Przywróć domyślne" }),
      screen.getByRole("button", { name: "Sprawdź mikrofon" }),
      screen.getByRole("button", { name: "Odtwórz dźwięk" }),
      screen.getByLabelText("Kamera"),
    ];

    controls.slice(1).forEach((control, index) => {
      const before = controls[index]!;
      expect(before.compareDocumentPosition(control)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
  });

  it("picks a microphone, and offers the system default as its own choice", async () => {
    const user = userEvent.setup();
    const props = setup();
    const select = screen.getByLabelText("Mikrofon");

    await user.selectOptions(select, "mic-1");
    expect(props.onChange).toHaveBeenCalledWith({ inputDeviceId: "mic-1" });

    // Back to the default is `null`, not the empty string: an unplugged device
    // must fall back to whatever the system picks, not to a dead id.
    await user.selectOptions(select, "");
    expect(props.onChange).toHaveBeenCalledWith({ inputDeviceId: null });
  });

  it("applies VAD immediately and persists it when the adjustment ends", () => {
    const props = setup();
    const sensitivity = screen.getByLabelText(/Czułość wykrywania mowy/);

    fireEvent.change(sensitivity, { target: { value: "75" } });
    fireEvent.pointerUp(sensitivity);

    expect(props.onChange).toHaveBeenCalledWith({ vadSensitivity: 75 });
    expect(props.onVadCommit).toHaveBeenCalledWith(75);
  });

  it("routes playback, changes call volume and runs the speaker test", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const props = setup({ output: { ...idleOutput, start } });

    await user.selectOptions(screen.getByLabelText("Urządzenie wyjściowe"), "speaker-1");
    fireEvent.change(screen.getByLabelText("Głośność odtwarzania"), {
      target: { value: "55" },
    });
    await user.click(screen.getByRole("button", { name: "Odtwórz dźwięk" }));

    expect(props.onChange).toHaveBeenCalledWith({ outputDeviceId: "speaker-1" });
    expect(props.onChange).toHaveBeenCalledWith({ outputVolume: 55 });
    expect(start).toHaveBeenCalledOnce();
  });

  it("offers a preset's curve, and keeps the bands off screen until the custom rung", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("radio", { name: /^Wyłączone/ }));
    expect(props.onChange).toHaveBeenCalledWith({
      playbackProfile: "off",
      playbackTuning: { warmthDb: 0, mudDb: 0, presenceDb: 0, airDb: 0, compression: 0 },
    });

    await user.click(screen.getByRole("radio", { name: /Broadcast/ }));
    expect(props.onChange).toHaveBeenCalledWith({
      playbackProfile: "broadcast",
      playbackTuning: { warmthDb: 6, mudDb: -6, presenceDb: 4, airDb: 2, compression: 90 },
    });

    // A preset is a finished answer: nudging one of its bands would no longer
    // be that preset, so the bands are not there to nudge.
    expect(screen.queryByLabelText(/^Ciepło/)).not.toBeInTheDocument();
  });

  it("turns a band moved on the custom rung into an edit of the custom curve", () => {
    const props = setup({ settings: { ...voiceSettings, playbackProfile: "custom" } });

    expect(screen.getByLabelText(/^Ciepło/)).toHaveValue("3.5");
    fireEvent.change(screen.getByLabelText(/^Ciepło/), { target: { value: "-1.5" } });

    expect(props.onChange).toHaveBeenCalledWith({
      playbackProfile: "custom",
      playbackTuning: { ...voiceSettings.playbackTuning, warmthDb: -1.5 },
    });
  });

  it("selects a camera and starts a local-only preview", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const props = setup({ camera: { ...idleCamera, start } });

    await user.selectOptions(screen.getByLabelText("Kamera"), "camera-1");
    await user.click(screen.getByRole("button", { name: "Sprawdź kamerę" }));

    expect(props.onChange).toHaveBeenCalledWith({ videoDeviceId: "camera-1" });
    expect(start).toHaveBeenCalledOnce();
  });

  it("reads back what the detector decided while the test runs", () => {
    setup({ mic: { ...idleMic, running: true, speaking: true, level: 0.75, peak: 0.9 } });

    expect(screen.getByRole("meter", { name: "Poziom mikrofonu" })).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(screen.getByText(/To trafiłoby do rozmowy/)).toBeInTheDocument();
  });

  it("does not claim a noise suppressor that failed to start", () => {
    setup({
      settings: { ...voiceSettings, noiseSuppression: "rnnoise" },
      // Asked for RNNoise; the pipeline fell back to the browser's own.
      mic: { ...idleMic, running: true, activeNoiseSuppression: "browser" },
    });

    expect(
      screen.getByText(/Wybrano „RNNoise”, ale mikrofon czyści teraz redukcja przeglądarki/),
    ).toBeInTheDocument();
  });

  it("stays quiet when the suppressor is the one that was asked for", () => {
    setup({
      settings: { ...voiceSettings, noiseSuppression: "browser" },
      mic: { ...idleMic, running: true, activeNoiseSuppression: "browser" },
    });

    expect(screen.queryByText(/mikrofon czyści teraz/)).toBeNull();
  });

  it("changes the audio profile, and leaves the screen-share quality to the call's bar", () => {
    const props = setup();

    fireEvent.change(screen.getByRole("slider", { name: /Jakość dźwięku/ }), {
      target: { value: "1" },
    });

    expect(props.onChange).toHaveBeenCalledWith({ opusProfile: "balanced" });
    expect(screen.queryByRole("radiogroup", { name: "Jakość udostępniania ekranu" })).toBeNull();
  });
});

describe("VoicePane reset", () => {
  it("asks once before putting the voice settings back to defaults", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    expect(props.onReset).not.toHaveBeenCalled();
    // While it asks, the foot says what goes back.
    expect(screen.getByText(/wrócą do stanu wyjściowego/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tak, przywróć" }));
    expect(props.onReset).toHaveBeenCalledOnce();
    // Confirmed, so the pane is back to asking from the start.
    expect(screen.getByRole("button", { name: "Przywróć domyślne" })).toBeInTheDocument();
  });

  it("drops the question without resetting when it is cancelled", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(props.onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Tak, przywróć" })).toBeNull();
    expect(screen.getByRole("button", { name: "Przywróć domyślne" })).toBeInTheDocument();
  });
});
