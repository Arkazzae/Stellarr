import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Segmented, type SegmentedOption } from "./Segmented";

type Fit = "fit" | "fill" | "stretch";

const OPTIONS: SegmentedOption<Fit>[] = [
  { value: "fit", label: "Fit" },
  { value: "fill", label: "Fill", detail: "Crops the edges" },
  { value: "stretch", label: "Stretch", tone: "warn" },
];

function Harness({ initial, disabled }: { initial: Fit; disabled?: boolean }) {
  const [value, setValue] = useState<Fit>(initial);
  return (
    <Segmented
      options={OPTIONS}
      value={value}
      onChange={setValue}
      label="Scaling"
      disabled={disabled}
    />
  );
}

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(name) });

describe("Segmented", () => {
  it("is one radio group with the current choice checked", () => {
    render(<Harness initial="fill" />);

    expect(screen.getByRole("radiogroup", { name: "Scaling" })).toBeInTheDocument();
    expect(radio("Fill")).toBeChecked();
    expect(radio("Fit")).not.toBeChecked();
    expect(radio("Fill")).toHaveTextContent("Crops the edges");
  });

  it("offers a single tab stop, on the checked choice", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <Harness initial="fill" />
        <button type="button">After</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.tab();
    expect(radio("Fill")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("falls back to the first choice as the tab stop when none is checked", async () => {
    const user = userEvent.setup();
    render(<Harness initial={"gone" as Fit} />);

    await user.tab();

    expect(radio("Fit")).toHaveFocus();
  });

  it("moves focus and selection together with the arrow keys, wrapping at the ends", async () => {
    const user = userEvent.setup();
    render(<Harness initial="fit" />);
    radio("Fit").focus();

    await user.keyboard("{ArrowRight}");
    expect(radio("Fill")).toHaveFocus();
    expect(radio("Fill")).toBeChecked();

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(radio("Fit")).toHaveFocus();
    expect(radio("Fit")).toBeChecked();

    await user.keyboard("{ArrowLeft}");
    expect(radio("Stretch")).toHaveFocus();
    expect(radio("Stretch")).toBeChecked();

    await user.keyboard("{ArrowUp}");
    expect(radio("Fill")).toBeChecked();
  });

  it("jumps to the first and last choice with Home and End", async () => {
    const user = userEvent.setup();
    render(<Harness initial="fill" />);
    radio("Fill").focus();

    await user.keyboard("{End}");
    expect(radio("Stretch")).toBeChecked();
    expect(radio("Stretch")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(radio("Fit")).toBeChecked();
    expect(radio("Fit")).toHaveFocus();
  });

  it("selects by click and publishes the tone for styling", async () => {
    const user = userEvent.setup();
    render(<Harness initial="fit" />);

    await user.click(radio("Stretch"));

    expect(radio("Stretch")).toBeChecked();
    expect(radio("Stretch")).toHaveAttribute("data-tone", "warn");
    expect(radio("Fit")).not.toHaveAttribute("data-tone");
  });

  it("cannot be changed while disabled", async () => {
    const user = userEvent.setup();
    render(<Harness initial="fit" disabled />);

    await user.click(radio("Fill"));

    expect(radio("Fit")).toBeChecked();
    expect(radio("Fill")).toBeDisabled();
  });
});
