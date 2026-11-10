import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InviteModal, type InvitePersonVM } from "./InviteModal";

const PEOPLE: InvitePersonVM[] = [
  { id: "u1", displayName: "Kasia", initials: "KA", presence: "online", status: "W sieci" },
  {
    id: "u2",
    displayName: "Marek",
    initials: "MA",
    presence: "dnd",
    status: "Nie przeszkadzać",
    member: true,
  },
];

describe("InviteModal", () => {
  it("invites to the server and says who is already on it", async () => {
    const user = userEvent.setup();
    const onInvite = vi.fn();
    const onCopy = vi.fn();
    render(
      <InviteModal
        open
        onClose={vi.fn()}
        serverName="Stellarr"
        people={PEOPLE}
        inviteUrl="https://stellarr.gg/i/a7Fk2q"
        onInvite={onInvite}
        onCopy={onCopy}
      />,
    );

    // The dialog is server-scoped: no channel is named anywhere in it.
    expect(screen.getByRole("heading", { name: "Zaproś znajomych" })).toBeTruthy();
    expect(screen.getByText("Udostępnij wejście na serwer Stellarr")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Zaproś Kasia" }));
    expect(onInvite).toHaveBeenCalledWith("u1");
    expect(screen.getByRole("button", { name: "Zaproś Kasia" }).textContent).toContain("Wysłano");

    // A member has nowhere to be invited to, so the row states that instead.
    expect(screen.queryByRole("button", { name: "Zaproś Marek" })).toBeNull();
    expect(screen.getByText("Na serwerze")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Kopiuj/ }));
    expect(onCopy).toHaveBeenCalledWith("https://stellarr.gg/i/a7Fk2q");
  });

  it("offers to mint a link instead of sending one that does not exist", async () => {
    const user = userEvent.setup();
    const onCreateInvite = vi.fn();
    render(
      <InviteModal
        open
        onClose={vi.fn()}
        serverName="Stellarr"
        people={PEOPLE}
        inviteUrl=""
        onCreateInvite={onCreateInvite}
        onInvite={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Zaproś Kasia" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: /Nowy link/ }));
    expect(onCreateInvite).toHaveBeenCalledOnce();
  });

  it("narrows the list to what was typed", async () => {
    const user = userEvent.setup();
    render(
      <InviteModal
        open
        onClose={vi.fn()}
        serverName="Stellarr"
        people={PEOPLE}
        inviteUrl="https://stellarr.gg/i/a7Fk2q"
        onInvite={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Szukaj znajomego" }), "kas");
    expect(screen.queryByText("Marek")).toBeNull();
    expect(screen.getByText("Kasia")).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "Szukaj znajomego" }), "zzz");
    expect(screen.getByText("Brak wyników")).toBeTruthy();
  });
});
