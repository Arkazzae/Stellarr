import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountRow, type AccountRowProps } from "./AccountRow";

function setup(overrides: Partial<AccountRowProps> = {}) {
  const props: AccountRowProps = {
    user: { id: "u-maja-9", displayName: "Maja", initials: "MA", presence: "online" },
    onOpenSettings: vi.fn(),
    panel: {
      presence: "online",
      customStatus: "",
      onSetPresence: vi.fn(),
      onSaveCustomStatus: vi.fn(),
      onOpenSettings: vi.fn(),
      onLogout: vi.fn(),
    },
    ...overrides,
  };
  render(<AccountRow {...props} />);
  return props;
}

const handle = () => screen.getByRole("button", { name: "MajaOnline" });

describe("AccountRow panel", () => {
  it("opens the panel from the row and reports it on the handle", async () => {
    const user = userEvent.setup();
    setup();

    expect(handle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Twoja dostępność" })).toBeNull();

    await user.click(handle());

    expect(handle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Twoja dostępność" })).toBeVisible();
  });

  it("closes the panel after opening settings from it", async () => {
    const user = userEvent.setup();
    const { panel } = setup();
    await user.click(handle());

    const open = within(screen.getByRole("group", { name: "Twoja dostępność" }).parentElement!)
      .getByRole("button", { name: "Ustawienia użytkownika" });
    await user.click(open);

    expect(panel.onOpenSettings).toHaveBeenCalledOnce();
    expect(handle()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the panel after signing out from it", async () => {
    const user = userEvent.setup();
    const { panel } = setup();
    await user.click(handle());

    await user.click(screen.getByRole("button", { name: "Wyloguj się" }));

    expect(panel.onLogout).toHaveBeenCalledOnce();
    expect(handle()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the panel up when a presence is picked", async () => {
    const user = userEvent.setup();
    const { panel } = setup();
    await user.click(handle());

    await user.click(screen.getByRole("button", { name: /Zaraz wracam/ }));

    expect(panel.onSetPresence).toHaveBeenCalledWith("idle");
    expect(handle()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("AccountRow shortcuts", () => {
  it("opens user settings from the row", async () => {
    const user = userEvent.setup();
    const { onOpenSettings, panel } = setup();

    await user.click(screen.getByRole("button", { name: "Ustawienia użytkownika" }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(panel.onOpenSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Wiadomości prywatne/ })).not.toBeInTheDocument();
  });
});
