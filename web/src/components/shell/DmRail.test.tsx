import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DmRail, type DmRailProps } from "./DmRail";

function setup(overrides: Partial<DmRailProps> = {}) {
  const props: DmRailProps = {
    serversOpen: false,
    onToggleServers: vi.fn(),
    onBackToServer: vi.fn(),
    friendsActive: true,
    onOpenFriends: vi.fn(),
    pending: 0,
    conversations: [],
    activeDmId: null,
    onSelect: vi.fn(),
    onAddFriend: vi.fn(),
    ...overrides,
  };

  render(<DmRail {...props} />);
  return props;
}

describe("DmRail", () => {
  it("returns to the server from the top of the rail", async () => {
    const user = userEvent.setup();
    const { onBackToServer } = setup();

    await user.click(screen.getByRole("button", { name: "Wróć na serwer" }));

    expect(onBackToServer).toHaveBeenCalledOnce();
  });
});
