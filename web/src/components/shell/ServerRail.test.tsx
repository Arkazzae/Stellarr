import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ServerRail, type ServerRailProps } from "./ServerRail";

function setup(overrides: Partial<ServerRailProps> = {}) {
  const props: ServerRailProps = {
    open: true,
    onClose: vi.fn(),
    name: "Stellarr",
    mark: "ST",
    dmSpace: false,
    onOpenMessages: vi.fn(),
    onOpenServer: vi.fn(),
    unread: 0,
    ...overrides,
  };

  render(<ServerRail {...props} />);
  return props;
}

const launcher = () =>
  screen.getByRole("button", { name: "Dodaj serwer i więcej" });

describe("ServerRail launcher", () => {
  it("uses the uploaded server icon in place of the initials", () => {
    setup({ iconUrl: "/assets/server-icon" });

    expect(document.querySelector(".srv-icon")).toHaveAttribute(
      "src",
      "/assets/server-icon",
    );
    expect(document.querySelector(".srv-mark")).toBeNull();
  });

  it("keeps the menu shut until the tile is used", () => {
    setup();

    expect(launcher()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Utwórz serwer/ })).toBeNull();
  });

  it("opens on hover, the way the rest of the rail reveals its actions", async () => {
    const user = userEvent.setup();
    setup();

    await user.hover(launcher());

    expect(launcher()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Utwórz serwer/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Znajdź serwery/ })).toBeVisible();
  });

  it("runs the create action and closes behind it", async () => {
    const user = userEvent.setup();
    const onCreateServer = vi.fn();
    setup({ onCreateServer });

    await user.click(launcher());
    await user.click(screen.getByRole("button", { name: /Utwórz serwer/ }));

    expect(onCreateServer).toHaveBeenCalledOnce();
    expect(launcher()).toHaveAttribute("aria-expanded", "false");
  });

  it("renders every membership and selects a different server", async () => {
    const user = userEvent.setup();
    const onSelectServer = vi.fn();
    setup({
      activeServerId: "server-1",
      servers: [
        { id: "server-1", name: "Orbit", mark: "OR" },
        { id: "server-2", name: "Nocna zmiana", mark: "NZ" },
      ],
      onSelectServer,
    });

    await user.click(screen.getByRole("button", { name: "Nocna zmiana" }));

    expect(onSelectServer).toHaveBeenCalledWith("server-2");
    expect(screen.getByRole("button", { name: "Orbit" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("disables a row that has nothing behind it rather than hiding it", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(launcher());

    expect(
      screen.getByRole("button", { name: /Utwórz serwer\. Jeszcze niedostępne/ }),
    ).toBeDisabled();
  });
});
