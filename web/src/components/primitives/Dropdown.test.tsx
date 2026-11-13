import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Dropdown, type DropdownOption } from "./Dropdown";

const PROFILES: DropdownOption<string>[] = [
  { value: "voice", label: "Rozmowa", detail: "32 kb/s" },
  { value: "balanced", label: "Zrównoważony", detail: "64 kb/s" },
  { value: "premium", label: "Premium", detail: "96 kb/s" },
  { value: "studio", label: "Studio", detail: "Wymaga szybkiego łącza", disabled: true },
];

function setup(overrides: Partial<Parameters<typeof Dropdown>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <Dropdown
      options={PROFILES}
      value="balanced"
      onChange={onChange}
      label="Jakość dźwięku"
      {...overrides}
    />,
  );
  return { onChange, field: screen.getByRole("combobox", { name: "Jakość dźwięku" }) };
}

describe("Dropdown", () => {
  it("shows the current value and keeps the list closed until asked", () => {
    const { field } = setup();

    expect(field).toHaveTextContent("Zrównoważony");
    // The detail is a second line in the list and a tail on the field, which is
    // what the native select could not do without folding it into the label.
    expect(field).toHaveTextContent("64 kb/s");
    expect(field).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens, marks what is chosen, and commits a click", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup();

    await user.click(field);
    const list = screen.getByRole("listbox", { name: "Jakość dźwięku" });
    expect(
      screen.getByRole("option", { name: /Zrównoważony/ }),
    ).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("option", { name: /Premium/ }));

    expect(onChange).toHaveBeenCalledWith("premium");
    expect(list).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  /*
   * Focus never leaves the field: the list is pointed at by
   * `aria-activedescendant`, which is what keeps one tab stop for the whole
   * control — the thing a native select gives for free.
   */
  it("is driven from the keyboard without moving focus into the list", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup();

    field.focus();
    await user.keyboard("{ArrowDown}");
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(field).toHaveFocus();
    expect(field.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /Zrównoważony/ }).id,
    );

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("premium");
  });

  it("steps over what cannot be chosen", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup({ value: "voice" });

    field.focus();
    await user.keyboard("{ArrowDown}");

    // Clicking one does nothing and leaves the list open, rather than closing
    // it on a choice that was refused.
    await user.click(screen.getByRole("option", { name: /Studio/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Studio is last, so "End" means the last option anyone can actually pick.
    await user.keyboard("{End}{Enter}");
    expect(onChange).toHaveBeenCalledWith("premium");
  });

  it("closes on Escape without choosing, and keeps the key from the page behind it", async () => {
    const user = userEvent.setup();
    // Stands in for whatever is behind the list: a dialog beneath it on the
    // stack, or the shell's own Escape handler on `window`.
    const page = vi.fn();
    const onChange = vi.fn();
    window.addEventListener("keydown", page);
    render(<Dropdown options={PROFILES} value="voice" onChange={onChange} label="Jakość" />);

    const field = screen.getByRole("combobox", { name: "Jakość" });
    field.focus();
    await user.keyboard("{ArrowDown}");
    page.mockClear();

    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", page);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(page).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("jumps to an option by typing its first letters", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup();

    field.focus();
    // Closed, typing picks outright — the same as a native select.
    await user.keyboard("pr");

    expect(onChange).toHaveBeenCalledWith("premium");
  });

  it("says so when the value names nothing in the list", () => {
    setup({ value: "gone", placeholder: "Urządzenie niedostępne" });

    expect(
      screen.getByRole("combobox", { name: "Jakość dźwięku" }),
    ).toHaveTextContent("Urządzenie niedostępne");
  });
});
