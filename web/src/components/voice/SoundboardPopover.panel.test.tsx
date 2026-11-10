import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Sound } from "@/ports";

import { SoundboardGrid, SoundboardPopover } from "./SoundboardPopover";

const drum: Sound = {
  id: "drum",
  name: "Bęben",
  glyph: "🥁",
  url: "/assets/drum",
  durationSeconds: 1,
  trimStartSeconds: 0,
  trimEndSeconds: 1,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("SoundboardGrid", () => {
  it("highlights a pressed tile briefly and then lets it go", () => {
    vi.useFakeTimers();
    render(
      <SoundboardGrid
        sounds={[drum]}
        onPlaySound={vi.fn()}
        volume={100}
        onVolumeChange={vi.fn()}
      />,
    );
    const tile = screen.getByRole("button", { name: "Bęben" });

    act(() => tile.click());
    expect(tile).toHaveClass("play");

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(tile).not.toHaveClass("play");
  });

  it("keeps the tiles but disables them when playback is not supported", async () => {
    const user = userEvent.setup();
    const onPlaySound = vi.fn();
    render(
      <SoundboardGrid
        sounds={[drum]}
        onPlaySound={onPlaySound}
        volume={100}
        onVolumeChange={vi.fn()}
        supported={false}
      />,
    );

    const tile = screen.getByRole("button", { name: "Bęben" });
    expect(tile).toBeDisabled();
    await user.click(tile);
    expect(onPlaySound).not.toHaveBeenCalled();
  });

  it("shows the current level next to the slider", () => {
    render(
      <SoundboardGrid
        sounds={[]}
        onPlaySound={vi.fn()}
        volume={42}
        onVolumeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("slider", { name: "Głośność soundboardu" })).toHaveValue("42");
    expect(screen.getByText("42%")).toBeVisible();
  });
});

function Harness({ onPlaySound }: { onPlaySound: (soundId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <SoundboardPopover
      sounds={[drum]}
      open={open}
      onOpenChange={setOpen}
      onPlaySound={onPlaySound}
      volume={100}
      onVolumeChange={vi.fn()}
      className="vc-pop"
      renderTrigger={(props) => (
        <button type="button" {...props}>
          Dźwięki
        </button>
      )}
    />
  );
}

describe("SoundboardPopover", () => {
  it("opens from its trigger, plays a sound and closes on Escape", async () => {
    const user = userEvent.setup();
    const onPlaySound = vi.fn();
    render(<Harness onPlaySound={onPlaySound} />);

    const trigger = screen.getByRole("button", { name: "Dźwięki" });
    const panel = document.querySelector<HTMLElement>(".dock-pop.board.vc-pop");
    expect(panel).toHaveAttribute("hidden");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");

    await user.click(screen.getByRole("button", { name: "Bęben" }));
    expect(onPlaySound).toHaveBeenCalledWith("drum");

    await user.keyboard("{Escape}");
    expect(panel).toHaveAttribute("hidden");
    expect(trigger).toHaveFocus();
  });
});
