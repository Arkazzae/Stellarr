import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Dropdown, type DropdownOption } from "./Dropdown";

const OPTIONS: DropdownOption<string>[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

function setup(props: Partial<Parameters<typeof Dropdown>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <>
      <Dropdown options={OPTIONS} value="a" onChange={onChange} label="Letter" {...props} />
      <button type="button">Elsewhere</button>
    </>,
  );
  return { onChange, field: screen.getByRole("combobox", { name: "Letter" }) };
}

describe("Dropdown closing", () => {
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
    await user.click(screen.getByRole("option", { name: /Alpha/ }));

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
        <Dropdown options={OPTIONS} value="a" onChange={vi.fn()} label="Letter" />
      </div>,
    );
    screen.getByRole("combobox", { name: "Letter" }).focus();

    await user.keyboard("{Escape}");

    expect(outer).toHaveBeenCalled();
  });
});
