import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomEmoji } from "@/ports";

import { EmojiPicker } from "./EmojiPicker";

const custom: CustomEmoji[] = [
  { id: "e-1", shortcode: "mushris", glyph: "https://cdn.example/mushris.png" },
  { id: "e-2", shortcode: "pepe", glyph: "https://cdn.example/pepe.png" },
];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  window.innerWidth = 1024;
});

describe("EmojiPicker", () => {
  it("finds an emoji by a Polish word, with or without the diacritics", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    const search = screen.getByRole("textbox", { name: "Szukaj emoji" });
    await user.type(search, "żaba");
    expect(screen.getByRole("option", { name: ":zaba:" })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zaba");
    expect(screen.getByRole("option", { name: ":zaba:" })).toBeInTheDocument();
  });

  it("puts the server's own emoji first and marks where they came from", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker customEmoji={custom} onPick={vi.fn()} />);

    const sections = screen.getAllByRole("heading", { level: 3 });
    expect(sections[0]).toHaveTextContent("Emoji serwera");

    await user.hover(screen.getByRole("option", { name: ":mushris:" }));
    expect(screen.getByText("z serwera")).toBeInTheDocument();
  });

  it("sends the first match on Enter, so the mouse is never required", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    await user.type(screen.getByRole("textbox", { name: "Szukaj emoji" }), "zaba");
    await user.keyboard("{Enter}");

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ shortcode: "zaba", glyph: "🐸" }),
    );
  });

  it("walks the grid with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    // Down out of the search field lands on the grid, and Right steps along it.
    await user.type(screen.getByRole("textbox", { name: "Szukaj emoji" }), "u");
    await user.keyboard("{ArrowDown}{ArrowRight}");

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("keeps six columns until nine full touch targets fit", async () => {
    window.innerWidth = 520;
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    const search = screen.getByRole("textbox", { name: "Szukaj emoji" });
    await user.click(search);
    await user.keyboard("{ArrowDown}");
    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveFocus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    expect(options[6]).toHaveFocus();
    expect(options[6]).toHaveAttribute("aria-selected", "true");
  });

  it("does not pull focus back to the search when the opening frame comes late", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      render(<EmojiPicker onPick={vi.fn()} />);
      const first = screen.getAllByRole("option")[0]!;
      first.focus();
      // A loaded machine: the frame scheduled at opening runs only now.
      for (const frame of frames) frame(0);
      expect(first).toHaveFocus();
    } finally {
      requestFrame.mockRestore();
    }
  });

  it("remembers what was picked and offers it again first", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<EmojiPicker onPick={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Szukaj emoji" }), "zaba");
    await user.click(screen.getByRole("option", { name: ":zaba:" }));
    unmount();

    // A second opening reads the same device storage the first one wrote.
    render(<EmojiPicker onPick={vi.fn()} />);
    const first = screen.getAllByRole("heading", { level: 3 })[0];
    expect(first).toHaveTextContent("Często używane");

    const recents = first?.nextElementSibling;
    expect(
      within(recents as HTMLElement).getByRole("option", { name: ":zaba:" }),
    ).toBeInTheDocument();
  });

  it("says so when nothing matches, rather than showing an empty grid", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    await user.type(
      screen.getByRole("textbox", { name: "Szukaj emoji" }),
      "qqqqqqq",
    );

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText(/Nic takiego nie ma/)).toBeInTheDocument();
  });
});
