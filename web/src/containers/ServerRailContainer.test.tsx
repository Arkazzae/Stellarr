import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { ServerRailContainer } from "./ServerRailContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);

const ORBIT = { id: "srv-orbit", name: "Orbit" };
const KOMETA = { id: "srv-kometa", name: "Kometa" };

beforeEach(() => {
  resetStubs();
  setStubs({
    directory: { server: ORBIT, servers: [ORBIT, KOMETA] },
  });
});

afterEach(() => {
  window.innerWidth = 1024;
});

describe("ServerRailContainer", () => {
  it("switches server, returns to its channels and reloads the session", async () => {
    const user = userEvent.setup();
    render(<ServerRailContainer />);

    await user.click(screen.getByRole("button", { name: "Kometa" }));

    expect(stubs.directory.selectServer).toHaveBeenCalledWith("srv-kometa");
    expect(stubs.ui.openServer).toHaveBeenCalled();
    expect(stubs.session.reload).toHaveBeenCalled();
  });

  it("keeps the column open when the active server is clicked on a wide screen", async () => {
    const user = userEvent.setup();
    render(<ServerRailContainer />);

    await user.click(screen.getByRole("button", { name: "Orbit" }));

    expect(screen.getByRole("navigation")).not.toHaveAttribute("inert");
    expect(stubs.ui.setRailOpen).not.toHaveBeenCalled();
  });

  it("follows the rail drawer instead on a narrow screen", async () => {
    window.innerWidth = 500;
    setStubs({ ui: { railOpen: false } });
    const user = userEvent.setup();
    const { container, rerender } = render(<ServerRailContainer />);
    expect(container.querySelector("nav")).toHaveAttribute("inert");

    setStubs({ ui: { railOpen: true } });
    rerender(<ServerRailContainer />);
    expect(container.querySelector("nav")).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Orbit" }));
    expect(stubs.ui.setRailOpen).toHaveBeenCalledWith(false);
  });

  it("offers the client download except inside the desktop client", async () => {
    const user = userEvent.setup();
    const first = render(<ServerRailContainer />);
    await user.click(first.getByRole("button", { name: "Dodaj serwer i więcej" }));
    await user.click(await first.findByRole("button", { name: /Pobierz aplikację/ }));
    expect(stubs.ui.openModal).toHaveBeenCalledWith("client");
    first.unmount();

    setStubs({ ports: { desktop: {} as never } });
    const second = render(<ServerRailContainer />);
    await user.click(second.getByRole("button", { name: "Dodaj serwer i więcej" }));
    expect(second.queryByRole("button", { name: /Pobierz aplikację/ })).toBeNull();
  });
});
