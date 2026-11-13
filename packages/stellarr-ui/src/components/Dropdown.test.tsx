import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./Dialog";
import { Dropdown, type DropdownOption, type DropdownProps } from "./Dropdown";

const PROFILES: DropdownOption<string>[] = [
  { value: "voice", label: "Voice", detail: "32 kb/s" },
  { value: "balanced", label: "Balanced", detail: "64 kb/s" },
  { value: "premium", label: "Premium", detail: "96 kb/s" },
  { value: "studio", label: "Studio", detail: "Needs a fast link", disabled: true },
];

function setup(overrides: Partial<DropdownProps<string>> = {}) {
  const onChange = vi.fn();
  render(
    <>
      <Dropdown options={PROFILES} value="balanced" onChange={onChange} label="Sound quality" {...overrides} />
      <button type="button">Elsewhere</button>
    </>,
  );
  return { onChange, field: screen.getByRole("combobox", { name: "Sound quality" }) };
}

/** Owns the value, as a form does, so a choice shows in what the field submits. */
function Form({ initial, name, disabled }: { initial: string; name?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <form>
      <Dropdown
        options={PROFILES}
        value={value}
        onChange={setValue}
        label="Sound quality"
        name={name}
        disabled={disabled}
      />
    </form>
  );
}

function submission(): FormData {
  const form = document.querySelector("form");
  if (form === null) throw new Error("No form is rendered.");
  return new FormData(form);
}

describe("Dropdown", () => {
  it("shows the current value and keeps the list closed until asked", () => {
    const { field } = setup();

    expect(field).toHaveTextContent("Balanced");
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
    const list = screen.getByRole("listbox", { name: "Sound quality" });
    expect(screen.getByRole("option", { name: /Balanced/ })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("option", { name: /Premium/ }));

    expect(onChange).toHaveBeenCalledWith("premium");
    expect(list).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  // Focus never leaves the field: the list is pointed at by
  // `aria-activedescendant`, which is what keeps one tab stop for the whole
  // control, the thing a native select gives for free.
  it("is driven from the keyboard without moving focus into the list", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup();

    field.focus();
    await user.keyboard("{ArrowDown}");
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(field).toHaveFocus();
    expect(field.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /Balanced/ }).id);

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
    window.addEventListener("keydown", page);
    const { onChange, field } = setup({ value: "voice" });

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
    // Closed, typing picks outright, the same as a native select.
    await user.keyboard("pr");

    expect(onChange).toHaveBeenCalledWith("premium");
  });

  it("leaves on Tab without choosing the option under the cursor", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup();
    field.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");

    await user.keyboard("{Tab}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on a press elsewhere, and on a second press on the field", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup();

    await user.click(field);
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(field);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(field);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not report a choice that is already the value", async () => {
    const user = userEvent.setup();
    const { onChange, field } = setup();

    await user.click(field);
    await user.click(screen.getByRole("option", { name: /Balanced/ }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ignores the keyboard while disabled", async () => {
    const user = userEvent.setup();
    const { field } = setup({ disabled: true });
    expect(field).toBeDisabled();

    await user.keyboard("{ArrowDown}");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("lets Escape through while the list is closed", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Dropdown options={PROFILES} value="voice" onChange={vi.fn()} label="Outer" />
      </div>,
    );
    screen.getByRole("combobox", { name: "Outer" }).focus();

    await user.keyboard("{Escape}");

    expect(outer).toHaveBeenCalled();
  });

  it("places the list through custom properties and shows it once placed", async () => {
    const user = userEvent.setup();
    const { field } = setup();

    await user.click(field);

    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute("data-placed");
    expect(list.style.getPropertyValue("--_x")).toMatch(/px$/);
    expect(list.style.getPropertyValue("--_y")).toMatch(/px$/);
    expect(list.style.getPropertyValue("--_dropdown-width")).toMatch(/px$/);
    expect(list.style.getPropertyValue("--_dropdown-max-height")).toMatch(/px$/);
    expect(list.style.left).toBe("");
    expect(list.style.top).toBe("");
  });

  describe("placing a bordered list", () => {
    const FIELD = { top: 700, bottom: 736, left: 20, right: 220, width: 200, height: 36, x: 20, y: 700 } as DOMRect;
    afterEach(() => vi.restoreAllMocks());

    /** The list's size as layout would give it; every other element measures nothing. */
    const ofList = (size: number) =>
      function (this: Element) {
        return this.getAttribute("role") === "listbox" ? size : 0;
      };

    /** Opens the list from a field near the bottom of the window, so it flips above. */
    async function openAbove(borders: number) {
      const user = userEvent.setup();
      const { field } = setup();
      vi.spyOn(field, "getBoundingClientRect").mockReturnValue(FIELD);
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(ofList(300));
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(ofList(300 + borders));
      vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(ofList(300));
      await user.click(field);
      return screen.getByRole("listbox").style.getPropertyValue("--_y");
    }

    it("clears the field by the list's full height, borders included", async () => {
      // 700 (field top) - 6 (gap) - 302 (300 of content and 2 of borders).
      expect(await openAbove(2)).toBe("392px");
    });

    it("places a list with no border as it always was", async () => {
      expect(await openAbove(0)).toBe("394px");
    });
  });

  describe("placing a list whose labels wrap", () => {
    const FIELD = { top: 700, bottom: 736, left: 20, right: 220, width: 200, height: 36, x: 20, y: 700 } as DOMRect;
    afterEach(() => vi.restoreAllMocks());

    it("measures the list at the width it will have, so it clears the field when it opens above", async () => {
      const user = userEvent.setup();
      const { field } = setup();
      vi.spyOn(field, "getBoundingClientRect").mockReturnValue(FIELD);
      // As layout would have it: with no width yet the list is as wide as its
      // longest label and one line shorter than at the field's width.
      const height = function (this: HTMLElement) {
        if (this.getAttribute("role") !== "listbox") return 0;
        return this.style.getPropertyValue("--_dropdown-width") === "" ? 280 : 300;
      };
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(height);
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(height);
      vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(height);

      await user.click(field);

      const list = screen.getByRole("listbox");
      expect(list.style.getPropertyValue("--_dropdown-width")).toBe("200px");
      // 700 (field top) - 6 (gap) - 300 (the height at that width).
      expect(list.style.getPropertyValue("--_y")).toBe("394px");
    });
  });

  describe("inside a dialog that holds the page", () => {
    it("lets the list scroll by wheel, and the page behind it still not", async () => {
      const user = userEvent.setup();
      render(
        <>
          <p>Page</p>
          <Dialog open onOpenChange={vi.fn()}>
            <DialogContent closeLabel="Close">
              <DialogTitle>Quality</DialogTitle>
              <DialogDescription>Pick one.</DialogDescription>
              <Dropdown options={PROFILES} value="balanced" onChange={vi.fn()} label="Sound quality" />
            </DialogContent>
          </Dialog>
        </>,
      );

      await user.click(screen.getByRole("combobox", { name: "Sound quality" }));

      // `fireEvent` returns false when the event was cancelled.
      expect(fireEvent.wheel(screen.getByRole("option", { name: /Premium/ }))).toBe(true);
      expect(fireEvent.wheel(screen.getByText("Page"))).toBe(false);
    });
  });

  describe("when the value names nothing in the list", () => {
    it("shows the placeholder", () => {
      const { field } = setup({ value: "gone", placeholder: "Device unavailable" });

      expect(field).toHaveTextContent("Device unavailable");
    });

    it("is empty without one", () => {
      const { field } = setup({ value: "gone" });

      expect(field.textContent).toBe("");
      expect(field.querySelector(".ui-dropdown-label")).toBeNull();
    });

    it("prefers the chosen option to the placeholder", () => {
      const { field } = setup({ placeholder: "Choose…" });

      expect(field).toHaveTextContent("Balanced");
      expect(field).not.toHaveTextContent("Choose…");
    });
  });

  describe("in a form", () => {
    it("submits the value under its name, and the new one after a choice", async () => {
      const user = userEvent.setup();
      render(<Form initial="balanced" name="quality" />);
      expect(submission().get("quality")).toBe("balanced");

      await user.click(screen.getByRole("combobox", { name: "Sound quality" }));
      await user.click(screen.getByRole("option", { name: /Premium/ }));

      expect(submission().get("quality")).toBe("premium");
    });

    it("keeps the hidden input inside the field, so the field has no sibling of its own", () => {
      render(<Form initial="balanced" name="quality" />);

      const field = screen.getByRole("combobox", { name: "Sound quality" });
      expect(field.querySelector('input[type="hidden"]')).not.toBeNull();
      expect(field.previousElementSibling).toBeNull();
      expect(field.nextElementSibling).toBeNull();
    });

    it("submits nothing without a name", () => {
      render(<Form initial="balanced" />);

      expect([...submission().keys()]).toEqual([]);
    });

    it("submits nothing while disabled", () => {
      render(<Form initial="balanced" name="quality" disabled />);

      expect([...submission().keys()]).toEqual([]);
    });
  });

  describe("language", () => {
    const LANGUAGES: DropdownOption<string>[] = [
      { value: "pl", label: "Polski", lang: "pl" },
      { value: "de", label: "Deutsch", lang: "de" },
      { value: "en", label: "English" },
    ];

    it("marks the chosen label and each row with the option's own", async () => {
      const user = userEvent.setup();
      render(<Dropdown options={LANGUAGES} value="de" onChange={vi.fn()} label="Language" />);
      const field = screen.getByRole("combobox", { name: "Language" });

      expect(screen.getByText("Deutsch")).toHaveAttribute("lang", "de");

      await user.click(field);
      expect(screen.getByRole("option", { name: "Polski" })).toHaveAttribute("lang", "pl");
      expect(screen.getByRole("option", { name: "Deutsch" })).toHaveAttribute("lang", "de");
    });

    it("leaves an option without one in the page's language", async () => {
      const user = userEvent.setup();
      render(<Dropdown options={LANGUAGES} value="en" onChange={vi.fn()} label="Language" />);

      expect(screen.getByText("English")).not.toHaveAttribute("lang");

      await user.click(screen.getByRole("combobox", { name: "Language" }));
      expect(screen.getByRole("option", { name: "English" })).not.toHaveAttribute("lang");
    });
  });

  describe("when refused", () => {
    it("says so on the field", () => {
      const { field } = setup({ invalid: true });

      expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("says nothing when it is not", () => {
      const { field } = setup({ invalid: false });

      expect(field).not.toHaveAttribute("aria-invalid");
    });

    it("is described by the text it is pointed at", () => {
      render(
        <>
          <Dropdown options={PROFILES} value="voice" onChange={vi.fn()} label="Link" aria-describedby="hint" />
          <p id="hint">Pick what the connection can carry.</p>
        </>,
      );

      expect(screen.getByRole("combobox", { name: "Link" })).toHaveAccessibleDescription(
        "Pick what the connection can carry.",
      );
    });
  });

  it("publishes its variant for the stylesheet, as a field by default", () => {
    const { rerender } = render(<Dropdown options={PROFILES} value="voice" onChange={vi.fn()} label="Link" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("data-variant", "field");

    rerender(<Dropdown options={PROFILES} value="voice" onChange={vi.fn()} label="Link" variant="quiet" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("data-variant", "quiet");
  });

  it("adds the caller's class to its own", () => {
    const { field } = setup({ className: "wide" });

    expect(field).toHaveClass("ui-dropdown", "wide");
  });
});
