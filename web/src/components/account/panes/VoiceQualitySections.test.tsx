import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VoiceAudioQualityRow } from "./VoiceQualitySections";
import { voiceSettings } from "./voiceTestFixtures";

const slider = () => screen.getByRole("slider", { name: /Jakość dźwięku/ });

describe("VoiceAudioQualityRow", () => {
  it("is one slider from thrifty to studio, on the profile in use", () => {
    render(<VoiceAudioQualityRow settings={voiceSettings} onChange={vi.fn()} />);

    expect(slider()).toHaveAttribute("min", "0");
    expect(slider()).toHaveAttribute("max", "4");
    expect(slider()).toHaveValue("3");
    // The stop is spoken by its name and its cost, not by its index.
    expect(slider()).toHaveAttribute("aria-valuetext", "Premium, 128 kb/s");
    expect(screen.getByText(/128 kb\/s, FEC i ciągła transmisja/)).toBeInTheDocument();
  });

  it("names the bitrate of every stop under the track", () => {
    const { container } = render(
      <VoiceAudioQualityRow settings={voiceSettings} onChange={vi.fn()} />,
    );

    const ticks = Array.from(container.querySelectorAll(".vc-ticks i"), (tick) => tick.textContent);
    expect(ticks).toEqual(["32", "64", "96", "128", "256"]);
  });

  it("changes the profile the encoder uses", () => {
    const onChange = vi.fn();
    render(<VoiceAudioQualityRow settings={voiceSettings} onChange={onChange} />);

    fireEvent.change(slider(), { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith({ opusProfile: "studio" });

    fireEvent.change(slider(), { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith({ opusProfile: "balanced" });
  });
});
