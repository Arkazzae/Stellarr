import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteModal, type InvitePersonVM } from "./InviteModal";

const PEOPLE: InvitePersonVM[] = [
  { id: "u1", displayName: "Kasia", initials: "KA", presence: "online", status: "W sieci" },
  { id: "u2", displayName: "Marek", initials: "MA", presence: "online", status: "W sieci" },
];

const LINK = "https://stellarr.gg/i/a7Fk2q";

function Dialog({
  open = true,
  inviteUrl = LINK,
  ...props
}: Partial<React.ComponentProps<typeof InviteModal>>) {
  return (
    <InviteModal
      open={open}
      onClose={vi.fn()}
      serverName="Stellarr"
      people={PEOPLE}
      inviteUrl={inviteUrl}
      onInvite={vi.fn().mockResolvedValue(undefined)}
      onCopy={vi.fn()}
      {...props}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("InviteModal", () => {
  it("lets a failed invite be sent again and says it failed", async () => {
    const user = userEvent.setup();
    const onInvite = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);

    render(<Dialog onInvite={onInvite} />);

    await user.click(screen.getByRole("button", { name: "Zaproś Kasia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się wysłać zaproszenia. Spróbuj ponownie.",
    );
    expect(screen.getByRole("button", { name: "Zaproś Kasia" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Zaproś Kasia" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Zaproś Kasia" })).toHaveTextContent("Wysłano");
    expect(onInvite).toHaveBeenCalledTimes(2);
  });

  it("shows an invite in flight and refuses to send it twice", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onInvite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    render(<Dialog onInvite={onInvite} />);

    await user.click(screen.getByRole("button", { name: "Zaproś Kasia" }));
    const pending = screen.getByRole("button", { name: "Zaproś Kasia" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveTextContent("Wysyłanie…");
    expect(screen.getByRole("button", { name: "Zaproś Marek" })).toBeEnabled();

    finish();
    await vi.waitFor(() => expect(pending).toHaveTextContent("Wysłano"));
    expect(onInvite).toHaveBeenCalledOnce();
  });

  it("marks the people the container already knows were invited", () => {
    render(<Dialog invitedIds={["u2"]} />);

    expect(screen.getByRole("button", { name: "Zaproś Marek" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zaproś Marek" })).toHaveTextContent("Wysłano");
    expect(screen.getByRole("button", { name: "Zaproś Kasia" })).toBeEnabled();
  });

  it("reports a link that could not be minted", async () => {
    const user = userEvent.setup();
    const onCreateInvite = vi.fn().mockRejectedValue(new Error("denied"));

    render(<Dialog inviteUrl="" onCreateInvite={onCreateInvite} />);

    await user.click(screen.getByRole("button", { name: /Nowy link/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się utworzyć aktywnego linku zaproszenia.",
    );
  });

  it("does not offer to mint a link the port cannot create", () => {
    render(<Dialog inviteUrl="" />);

    expect(screen.getByText("Ten serwer nie ma jeszcze aktywnego linku.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nowy link/ })).toBeNull();
  });

  it("flashes the copied state and then goes back to the copy action", () => {
    vi.useFakeTimers();
    render(<Dialog />);

    act(() => screen.getByRole("button", { name: /Kopiuj/ }).click());
    expect(screen.getByRole("button", { name: /Skopiowano/ })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByRole("button", { name: /Kopiuj/ })).toBeInTheDocument();
  });

  it("forgets the search and who was invited when it closes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog />);

    await user.type(screen.getByRole("searchbox", { name: "Szukaj znajomego" }), "kas");
    await user.click(screen.getByRole("button", { name: "Zaproś Kasia" }));
    expect(screen.getByRole("button", { name: "Zaproś Kasia" })).toHaveTextContent("Wysłano");

    rerender(<Dialog open={false} />);
    rerender(<Dialog />);

    expect(screen.getByRole("searchbox", { name: "Szukaj znajomego" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Zaproś Kasia" })).toHaveTextContent("Zaproś");
    expect(screen.getByRole("button", { name: "Zaproś Kasia" })).toBeEnabled();
  });
});
