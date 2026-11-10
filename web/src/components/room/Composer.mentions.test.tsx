import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Composer, type MentionCandidate } from "./Composer";

const people: MentionCandidate[] = [
  { id: "u-zed", username: "zed", displayName: "Aaron Zed" },
  { id: "u-alan", username: "alan", displayName: "Alan Turing" },
  { id: "u-ada", username: "ada", displayName: "Ada Lovelace" },
  { id: "u-bob", username: "bob", displayName: "Bob Stone" },
];

function setup(onSubmit = vi.fn()) {
  const user = userEvent.setup();
  render(
    <Composer
      channelName="general"
      chips={[]}
      onSubmit={onSubmit}
      onRemoveChip={vi.fn()}
      onRetryChip={vi.fn()}
      onReorderChips={vi.fn()}
      mentionCandidates={people}
    />,
  );
  return { user, onSubmit, field: screen.getByRole("combobox") as HTMLTextAreaElement };
}

const suggestions = () => screen.queryByRole("listbox", { name: "Oznacz osobę lub bota" });
const options = () => screen.getAllByRole("option").map((option) => option.textContent);

describe("Composer mentions", () => {
  it("offers matching people after @, usernames first, with the first one selected", async () => {
    const { user, field } = setup();

    await user.type(field, "@a");

    expect(suggestions()).toBeInTheDocument();
    // Names that start with the query, alphabetically, then names that merely
    // contain it in the display name. Bob matches neither.
    expect(options()).toEqual([
      expect.stringContaining("Ada Lovelace"),
      expect.stringContaining("Alan Turing"),
      expect.stringContaining("Aaron Zed"),
    ]);
    const [first, second] = screen.getAllByRole("option");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveAttribute("aria-selected", "false");
    expect(field).toHaveAttribute("aria-activedescendant", first!.id);
  });

  it.each(["{Tab}", "{Enter}"])("inserts the selected person on %s without sending", async (key) => {
    const { user, field, onSubmit } = setup();

    await user.type(field, "hej @a");
    await user.keyboard(key);

    expect(field).toHaveValue("hej @ada ");
    expect(suggestions()).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends on the next Enter, once the list is out of the way", async () => {
    const { user, field, onSubmit } = setup();

    await user.type(field, "@a");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("@ada");
  });

  it("moves the selection with the arrow keys and wraps around", async () => {
    const { user, field } = setup();

    await user.type(field, "@a");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(field).toHaveValue("@alan ");
  });

  it("closes on Escape without inserting, and reopens when the query changes", async () => {
    const { user, field } = setup();

    await user.type(field, "@a");
    await user.keyboard("{Escape}");

    expect(suggestions()).toBeNull();
    expect(field).toHaveValue("@a");

    await user.type(field, "l");
    expect(options()).toEqual([expect.stringContaining("Alan Turing")]);
  });

  it("inserts into the middle of a draft where the caret is", async () => {
    const { user, field } = setup();

    await user.type(field, "hi  there");
    field.setSelectionRange(3, 3);
    await user.keyboard("@a");
    await user.click(screen.getByRole("option", { name: /Ada Lovelace/ }));

    expect(field).toHaveValue("hi @ada there");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe("hi @ada".length);
  });

  it("stays closed when nothing matches or the @ is inside a word", async () => {
    const { user, field } = setup();

    await user.type(field, "@zzz");
    expect(suggestions()).toBeNull();

    await user.clear(field);
    await user.type(field, "write to me@a");
    expect(suggestions()).toBeNull();
  });

  it("treats @ as plain text in a code message", async () => {
    const { user, field } = setup();

    await user.click(screen.getByRole("button", { name: "Wyślij jako kod" }));
    await user.type(field, "@a");

    expect(suggestions()).toBeNull();
  });
});
