import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Sound } from "@/ports";

import { SoundboardGrid } from "./SoundboardPopover";

const sound = (id: string, name: string, glyph: string): Sound => ({
  id,
  name,
  glyph,
  url: `/assets/${id}`,
  durationSeconds: 3,
  trimStartSeconds: 0,
  trimEndSeconds: 3,
});

describe("SoundboardGrid", () => {
  it("shows a helpful empty state when the server has no sounds", () => {
    render(
      <SoundboardGrid
        sounds={[]}
        onPlaySound={vi.fn()}
        volume={100}
        onVolumeChange={vi.fn()}
      />,
    );

    const empty = screen.getByRole("status", {
      name: "Brak dźwięków w soundboardzie",
    });
    expect(empty).toHaveTextContent("Tu jeszcze cicho");
    expect(empty).toHaveTextContent(
      "Dźwięki dodane w ustawieniach serwera pojawią się tutaj.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps playing configured sounds", async () => {
    const user = userEvent.setup();
    const onPlaySound = vi.fn();
    render(
      <SoundboardGrid
        sounds={[
          {
            id: "drum",
            name: "Bęben",
            glyph: "🥁",
            url: "/sounds/notification.wav",
            durationSeconds: 1,
            trimStartSeconds: 0,
            trimEndSeconds: 1,
          },
        ]}
        onPlaySound={onPlaySound}
        volume={100}
        onVolumeChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Bęben" }));
    expect(onPlaySound).toHaveBeenCalledWith("drum");
  });

  it("changes the local soundboard volume from the drawer", () => {
    const onVolumeChange = vi.fn();
    render(
      <SoundboardGrid
        sounds={[]}
        onPlaySound={vi.fn()}
        volume={64}
        onVolumeChange={onVolumeChange}
      />,
    );

    const slider = screen.getByRole("slider", {
      name: "Głośność soundboardu",
    });
    expect(slider).toHaveValue("64");
    fireEvent.change(slider, { target: { value: "35" } });
    expect(onVolumeChange).toHaveBeenCalledWith(35);
  });

  it("cuts long names to one line so the board never scrolls sideways", () => {
    const name = "Bardzo długa nazwa dźwięku, która nie mieści się w kafelku";
    render(
      <SoundboardGrid
        sounds={[sound("long", name, "📯")]}
        onPlaySound={vi.fn()}
        volume={100}
        onVolumeChange={vi.fn()}
      />,
    );

    const tile = screen.getByRole("button", { name });
    expect(tile).toHaveAttribute("title", name);
    expect(tile.querySelector(".dp-snd-name")).toHaveTextContent(name);
  });

});
