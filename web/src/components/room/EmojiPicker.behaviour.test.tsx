import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMOJI } from "@/lib/emoji";

import { EmojiPicker } from "./EmojiPicker";

const searchBox = () => screen.getByRole("textbox", { name: "Szukaj emoji" });

beforeEach(() => {
  localStorage.clear();
});

describe("EmojiPicker keyboard and search", () => {
  it("closes on Escape in the search field", async () => {
    const onClose = vi.fn();
    render(<EmojiPicker onPick={vi.fn()} onClose={onClose} />);
    await userEvent.type(searchBox(), "{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("returns to the search field when arrowing up from the first row", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    await user.click(searchBox());
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(searchBox()).toHaveFocus();
  });

  it("stays on the first emoji when arrowing left from it", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    await user.click(searchBox());
    await user.keyboard("{ArrowDown}{ArrowLeft}");
    expect(screen.getAllByRole("option")[0]).toHaveFocus();
  });

  it("jumps to the last emoji with End and back with Home", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    await user.click(searchBox());
    await user.keyboard("{ArrowDown}{End}");
    const options = screen.getAllByRole("option");
    expect(options.at(-1)).toHaveFocus();

    await user.keyboard("{Home}");
    expect(options[0]).toHaveFocus();
  });

  it("picks the focused emoji and reports the full entry", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    await user.click(searchBox());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledExactlyOnceWith(EMOJI[0]);
  });

  it("finds a server emoji by its shortcode and shows it as an image", async () => {
    const user = userEvent.setup();
    render(
      <EmojiPicker
        customEmoji={[{ id: "e-1", shortcode: ":mushris:", glyph: "https://cdn.example/m.png" }]}
        onPick={vi.fn()}
      />,
    );

    await user.type(searchBox(), "mushr");
    const match = screen.getByRole("option", { name: ":mushris:" });
    expect(match.querySelector("img")).toHaveAttribute("src", "https://cdn.example/m.png");
  });

  it("brings the full list back when the search is cleared", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={vi.fn()} />);

    await user.type(searchBox(), "zaba");
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Wyczyść wyszukiwanie" }));
    expect(searchBox()).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(EMOJI.length);
    expect(searchBox()).toHaveFocus();
  });

  it("shows two rows of recents at most, newest first", async () => {
    localStorage.setItem(
      "stellarr.emoji.recent",
      JSON.stringify(EMOJI.slice(0, 30).map((item) => item.shortcode)),
    );
    render(<EmojiPicker onPick={vi.fn()} />);

    const heading = screen.getAllByRole("heading", { level: 3 })[0]!;
    expect(heading).toHaveTextContent("Często używane");
    const tiles = heading.nextElementSibling!.querySelectorAll("[role=option]");
    expect(tiles).toHaveLength(18);
    expect(tiles[0]).toHaveAccessibleName(`:${EMOJI[0]!.shortcode}:`);
  });

  it("drops a recent whose server emoji no longer exists", () => {
    localStorage.setItem("stellarr.emoji.recent", JSON.stringify(["deleted_one"]));
    render(<EmojiPicker onPick={vi.fn()} />);
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Miny i emocje");
  });
});
