import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { JoinSoundPicker } from "@/ports";

import { SoundsPane, type SoundsPaneProps } from "./SoundsPane";

const joinSound: JoinSoundPicker = {
  servers: [],
  loading: false,
  failed: false,
  selectedId: null,
  selectionAvailable: true,
  maxSeconds: 5,
  select: () => undefined,
  preview: () => undefined,
  reload: () => undefined,
};

function pane(overrides: Partial<SoundsPaneProps> = {}): SoundsPaneProps {
  return {
    joinSound,
    arrivalsAudible: true,
    onArrivalsAudibleChange: vi.fn(),
    soundboardVolume: 60,
    onSoundboardVolumeChange: vi.fn(),
    ...overrides,
  };
}

describe("SoundsPane", () => {
  it("puts your own arrival first, then what you hear in a call", () => {
    render(<SoundsPane {...pane()} />);

    const headings = [...document.querySelectorAll(".sc-h")].map((header) => header.textContent);
    expect(headings).toEqual(["Dźwięk wejścia", "W rozmowie"]);
  });

  it("switches hearing others come and go", async () => {
    const user = userEvent.setup();
    const props = pane();
    render(<SoundsPane {...props} />);

    await user.click(screen.getByRole("switch", { name: "Dźwięk wejścia i wyjścia" }));

    expect(props.onArrivalsAudibleChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("sets the soundboard level and shows it", () => {
    const props = pane();
    render(<SoundsPane {...props} />);

    const slider = screen.getByRole("slider", { name: "Głośność soundboardu" });
    expect(slider).toHaveValue("60");
    expect(screen.getByText("60%")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "25" } });

    expect(props.onSoundboardVolumeChange).toHaveBeenCalledExactlyOnceWith(25);
  });

  it("still offers the call sounds while the arrival picker is not wired", () => {
    render(<SoundsPane {...pane({ joinSound: undefined })} />);

    expect(screen.queryByText("Dźwięk wejścia")).toBeNull();
    expect(screen.getByRole("slider", { name: "Głośność soundboardu" })).toBeInTheDocument();
  });
});
