import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VoiceAudioQualitySection, VoiceScreenSharingSection } from "./VoiceQualitySections";
import { voiceSettings } from "./voiceTestFixtures";

describe("VoiceAudioQualitySection", () => {
  it("offers the profiles from thrifty to studio and marks the one in use", () => {
    render(<VoiceAudioQualitySection settings={voiceSettings} onChange={vi.fn()} />);

    const names = screen.getAllByRole("radio").map((radio) => radio.textContent);
    expect(names).toEqual(["Oszczędny", "Zrównoważony", "Wyrazisty", "Premium", "Studio"]);
    expect(screen.getByRole("radio", { name: "Premium" })).toBeChecked();
    expect(screen.getByText(/128 kb\/s, FEC i ciągła transmisja/)).toBeInTheDocument();
  });

  it("changes the profile the encoder uses", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VoiceAudioQualitySection settings={voiceSettings} onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Studio" }));

    expect(onChange).toHaveBeenCalledWith({ opusProfile: "studio" });
  });
});

describe("VoiceScreenSharingSection", () => {
  it("offers the screen qualities and marks the one in use", () => {
    render(<VoiceScreenSharingSection settings={voiceSettings} onChange={vi.fn()} />);

    const names = screen.getAllByRole("radio").map((radio) => radio.textContent);
    expect(names).toEqual(["Oszczędna", "Zrównoważona", "Wyraźna", "Ultra"]);
    expect(screen.getByRole("radio", { name: "Zrównoważona" })).toBeChecked();
  });

  it("changes the quality of shared screens", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VoiceScreenSharingSection settings={voiceSettings} onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Ultra" }));

    expect(onChange).toHaveBeenCalledWith({ screenShareQuality: "ultra" });
  });
});
