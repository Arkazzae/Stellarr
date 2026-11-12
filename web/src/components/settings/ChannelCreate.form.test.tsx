import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ChannelKind } from "@/ports";

import { ChannelCreate } from "./ChannelCreate";

function Dialog({
  kind = "text",
  open = true,
  supported = true,
}: {
  kind?: ChannelKind;
  open?: boolean;
  supported?: boolean;
}) {
  return (
    <ChannelCreate
      open={open}
      kind={kind}
      supported={supported}
      sections={[]}
      onCreate={vi.fn(() => Promise.resolve())}
      onClose={vi.fn()}
    />
  );
}

const nameField = () => screen.getByRole("textbox", { name: /Nazwa/ });

describe("ChannelCreate form", () => {
  it("previews the slug the channel will get, with a hash only for text", async () => {
    const user = userEvent.setup();
    render(<Dialog />);

    await user.type(nameField(), "Nowy  Kanał!");
    expect(screen.getByText("Powstanie #nowy-kanał")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Głosowy" }));
    expect(screen.getByText("Powstanie nowy-kanał")).toBeInTheDocument();
  });

  it("keeps the dialog's kind in step with the caption that opened it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog kind="voice" />);
    expect(screen.getByRole("radio", { name: "Głosowy" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Tekstowy" }));
    expect(screen.getByRole("radio", { name: "Tekstowy" })).toBeChecked();

    rerender(<Dialog kind="voice" open={false} />);
    rerender(<Dialog kind="voice" />);
    expect(screen.getByRole("radio", { name: "Głosowy" })).toBeChecked();
  });

  it("starts blank each time it opens", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog />);
    await user.type(nameField(), "stary");

    rerender(<Dialog open={false} />);
    rerender(<Dialog />);

    expect(nameField()).toHaveValue("");
  });

  it("is read-only and says why without permission to create channels", async () => {
    render(<Dialog supported={false} />);

    expect(screen.getByText("Nie masz uprawnienia do tworzenia kanałów.")).toBeInTheDocument();
    expect(nameField()).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Głosowy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dodaj kanał" })).toBeDisabled();
  });
});
