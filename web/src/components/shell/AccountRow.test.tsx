import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountRow, type AccountRowProps } from "./AccountRow";

function setup(overrides: Partial<AccountRowProps> = {}) {
  const props: AccountRowProps = {
    user: {
      id: "u-maja-9",
      displayName: "Maja",
      initials: "MA",
      presence: "online",
    },
    onOpenSettings: vi.fn(),
    panel: {
      presence: "online",
      presenceSupported: true,
      customStatus: "",
      customStatusSupported: true,
      onSetPresence: vi.fn(),
      onSaveCustomStatus: vi.fn(),
      onOpenSettings: vi.fn(),
      onLogout: vi.fn(),
    },
    ...overrides,
  };

  render(<AccountRow {...props} />);
}

describe("AccountRow", () => {
  it("shows a short presence label under the name", () => {
    setup();

    const trigger = screen.getByRole("button", { name: "MajaOnline" });
    expect(within(trigger).getByText("Online")).toBeVisible();
    expect(screen.queryByText("Jesteś i można pisać.")).toBeNull();
  });

  it("shows the custom status under the name when it is set", () => {
    setup({
      panel: {
        presence: "online",
        presenceSupported: true,
        customStatus: "🎧 na słuchawkach",
        customStatusSupported: true,
        onSetPresence: vi.fn(),
        onSaveCustomStatus: vi.fn(),
        onOpenSettings: vi.fn(),
        onLogout: vi.fn(),
      },
    });

    const trigger = screen.getByRole("button", {
      name: "Maja🎧 na słuchawkach",
    });
    expect(within(trigger).getByText("🎧 na słuchawkach")).toBeVisible();
  });
});
