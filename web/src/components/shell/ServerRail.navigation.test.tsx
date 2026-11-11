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

const messages = () =>
  screen.getByRole("button", { name: "Znajomi i wiadomości prywatne" });

describe("ServerRail navigation", () => {
  it("shows the active server alone when no memberships are given", () => {
    setup();

    expect(screen.getByRole("button", { name: "Stellarr" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("closes the column when the current server is chosen again", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Stellarr" }));

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onOpenServer).not.toHaveBeenCalled();
  });

  it("leaves the messages for the server when its tile is chosen from there", async () => {
    const user = userEvent.setup();
    const props = setup({ dmSpace: true });

    expect(messages()).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Stellarr" })).not.toHaveAttribute(
      "aria-current",
    );

    await user.click(screen.getByRole("button", { name: "Stellarr" }));

    expect(props.onOpenServer).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("opens the messages and counts what is unread there", async () => {
    const user = userEvent.setup();
    const props = setup({ unread: 4 });

    expect(messages()).toHaveTextContent("4");
    await user.click(messages());

    expect(props.onOpenMessages).toHaveBeenCalledOnce();
  });

  it("shows no count without unread messages", () => {
    setup({ unread: 0 });

    expect(messages()).not.toHaveTextContent(/\d/);
  });

  it("takes a closed column out of the tab order", () => {
    setup({ open: false });

    expect(document.querySelector("nav.srv-rail")).toHaveAttribute("inert");
  });
});
