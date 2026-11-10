import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { JoinSoundPicker } from "@/ports";

import { JoinSoundSection } from "./JoinSoundSection";

const picker: JoinSoundPicker = {
  servers: [
    {
      serverId: "server-1",
      serverName: "Stellarr",
      sounds: [
        {
          id: "sound-1",
          name: "Fanfara",
          glyph: "🎺",
          url: "/assets/att-1",
          durationSeconds: 8,
          trimStartSeconds: 0,
          trimEndSeconds: 5,
        },
        {
          id: "sound-2",
          name: "Gong",
          glyph: "🔔",
          url: "/assets/att-2",
          durationSeconds: 3,
          trimStartSeconds: 0,
          trimEndSeconds: 3,
        },
      ],
    },
  ],
  loading: false,
  failed: false,
  selectedId: null,
  selectionAvailable: true,
  maxSeconds: 5,
  select: () => undefined,
  preview: () => undefined,
  reload: () => undefined,
};

describe("JoinSoundSection", () => {
  it("groups sounds by server and selects one, or none again", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(<JoinSoundSection joinSound={{ ...picker, selectedId: "sound-1", select }} />);

    const field = screen.getByLabelText(/Twój dźwięk/);
    expect(screen.getByRole("group", { name: "Stellarr" })).toBeInTheDocument();
    expect(field).toHaveValue("sound-1");
    expect(screen.getByText(/najwyżej 5 s/)).toBeInTheDocument();

    await user.selectOptions(field, "sound-2");
    await user.selectOptions(field, "");

    expect(select).toHaveBeenNthCalledWith(1, "sound-2");
    expect(select).toHaveBeenNthCalledWith(2, null);
  });

  it("auditions only a choice that stands", async () => {
    const user = userEvent.setup();
    const preview = vi.fn();
    const { rerender } = render(<JoinSoundSection joinSound={{ ...picker, preview }} />);
    expect(screen.getByRole("button", { name: /Posłuchaj/ })).toBeDisabled();

    rerender(<JoinSoundSection joinSound={{ ...picker, selectedId: "sound-1", preview }} />);
    await user.click(screen.getByRole("button", { name: /Posłuchaj/ }));

    expect(preview).toHaveBeenCalledOnce();
  });

  it("keeps showing a sound whose server was left, without offering to play it", () => {
    render(
      <JoinSoundSection
        joinSound={{ ...picker, servers: [], selectedId: "sound-gone", selectionAvailable: false }}
      />,
    );

    expect(screen.getByLabelText(/Twój dźwięk/)).toHaveValue("sound-gone");
    expect(screen.getByText(/serwera, na którym już Cię nie ma/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Posłuchaj/ })).toBeDisabled();
  });

  it("reports loading and an empty catalogue in the status line", () => {
    const { rerender } = render(<JoinSoundSection joinSound={{ ...picker, loading: true }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Wczytuję dźwięki");

    rerender(<JoinSoundSection joinSound={{ ...picker, servers: [] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Żaden z Twoich serwerów");
  });

  it("offers a retry when the catalogue could not be read", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    render(<JoinSoundSection joinSound={{ ...picker, servers: [], failed: true, reload }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się wczytać dźwięków");
    expect(screen.getByRole("status")).toHaveTextContent("");

    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
