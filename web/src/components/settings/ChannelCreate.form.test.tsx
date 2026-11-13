import { render, screen, within } from "@testing-library/react";
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
      serverName="Orbit"
      supported={supported}
      sections={[{ id: "sec-1", name: "Ogłoszenia" }]}
      channels={[
        { id: "general", name: "general", kind: "text" },
        { id: "lounge", name: "lounge", kind: "voice" },
      ]}
      onCreate={vi.fn(() => Promise.resolve())}
      onClose={vi.fn()}
    />
  );
}

const nameField = () => screen.getByRole("textbox", { name: "Nazwa" });
const slice = () => screen.getByRole("group", { name: "Miejsce nowego kanału" });
const rowGroup = () => nameField().closest(".ch-place-group") as HTMLElement;
const moveButton = (group: string) =>
  screen.queryByRole("button", { name: `Przenieś nowy kanał do grupy ${group}` });

describe("ChannelCreate rail slice", () => {
  it("draws the server's rail with the new row in the group of the caption pressed", () => {
    render(<Dialog kind="voice" />);

    expect(screen.getByRole("dialog", { name: "Nowy kanał" })).toBeInTheDocument();
    for (const text of ["Orbit", "Tekstowe", "general", "Głosowe", "lounge", "Ogłoszenia"]) {
      expect(within(slice()).getByText(text)).toBeVisible();
    }
    expect(rowGroup()).toHaveTextContent("Głosowe");
    expect(moveButton("Głosowe")).toBeNull();
    expect(moveButton("Tekstowe")).toBeEnabled();
    expect(moveButton("Ogłoszenia")).toBeEnabled();
  });

  it("says what the name will become only while the typed name is reshaped", async () => {
    const user = userEvent.setup();
    const how = "Znak przełącza tekstowy i głosowy, a + przenosi go do innej grupy.";
    render(<Dialog />);

    expect(nameField()).toHaveAccessibleDescription(how);
    await user.type(nameField(), "plany");
    expect(nameField()).toHaveAccessibleDescription(how);

    await user.clear(nameField());
    await user.type(nameField(), "Nowy  Kanał!");
    expect(nameField()).toHaveAccessibleDescription("Powstanie #nowy-kanał");

    await user.click(screen.getByRole("button", { name: "Zmień na kanał głosowy" }));
    expect(nameField()).toHaveAccessibleDescription("Powstanie nowy-kanał");
  });

  it("keeps the kind in step with the caption that opened it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog kind="voice" />);

    await user.click(screen.getByRole("button", { name: "Zmień na kanał tekstowy" }));
    expect(rowGroup()).toHaveTextContent("Tekstowe");

    rerender(<Dialog kind="voice" open={false} />);
    rerender(<Dialog kind="voice" />);
    expect(rowGroup()).toHaveTextContent("Głosowe");
  });

  it("starts blank and back in its caption's group each time it opens", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog />);
    await user.type(nameField(), "stary");
    await user.click(moveButton("Ogłoszenia")!);
    expect(rowGroup()).toHaveTextContent("Ogłoszenia");

    rerender(<Dialog open={false} />);
    rerender(<Dialog />);

    expect(nameField()).toHaveValue("");
    expect(rowGroup()).toHaveTextContent("Tekstowe");
  });

  it("is read-only and says why without permission to create channels", () => {
    render(<Dialog supported={false} />);

    expect(screen.getByText("Nie masz uprawnienia do tworzenia kanałów.")).toBeInTheDocument();
    expect(nameField()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zmień na kanał głosowy" })).toBeDisabled();
    expect(moveButton("Głosowe")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Utwórz kanał" })).toBeDisabled();
  });
});
