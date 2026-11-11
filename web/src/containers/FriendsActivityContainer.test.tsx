import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/ports";
import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { FriendsActivityContainer } from "./FriendsActivityContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);

const ADA: User = { id: "ada", username: "ada", displayName: "Ada", presence: "online" };
const OLA: User = { id: "ola", username: "ola", displayName: "Ola", presence: "idle" };
const ZOSIA: User = { id: "zosia", username: "zosia", displayName: "Zosia", presence: "dnd" };
const friend = (user: User) => ({ user, since: "2026-01-01T12:00:00Z" });
const occupant = (user: User) => ({
  id: user.id,
  displayName: user.displayName,
  initials: user.displayName.slice(0, 2),
  presence: user.presence,
});
const panel = () => screen.getByRole("complementary", { name: "Aktywni teraz" });

beforeEach(resetStubs);

describe("FriendsActivityContainer", () => {
  it("lists reachable friends without revealing offline, blocked or non-friend occupants", () => {
    const offline = { ...ADA, id: "offline", displayName: "Niewidoczna", presence: "offline" } as const;
    const stranger = { ...ADA, id: "stranger", displayName: "Obca" };
    const blocked = { ...ADA, id: "blocked", displayName: "Zablokowana" };
    const self = { ...ADA, id: stubs.session.user!.id, displayName: "Ja" };
    setStubs({
      friends: {
        friends: [ADA, OLA, ZOSIA, offline, blocked, self].map(friend),
        blocked: [blocked],
      },
      directory: {
        voiceChannels: [{ id: "voice", name: "Salon", occupants: [offline, stranger].map(occupant) }],
      },
    });

    render(<FriendsActivityContainer />);

    expect(within(panel()).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("W sieci")).toBeInTheDocument();
    expect(screen.getByText("Zaraz wracam")).toBeInTheDocument();
    expect(screen.getByText("Nie przeszkadzać")).toBeInTheDocument();
    for (const name of ["Niewidoczna", "Zablokowana", "Obca", "Ja"]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });

  it("puts known calls first and shows the visible server channel and custom status", () => {
    setStubs({
      friends: {
        friends: [ADA, { ...OLA, customStatus: "  Piszę muzykę  " }, ZOSIA].map(friend),
        conversations: [{
          id: "dm-zosia", peer: ZOSIA, unread: 0, updatedAt: "2026-01-01T12:00:00Z",
          callParticipants: [{ userId: ZOSIA.id, displayName: ZOSIA.displayName, muted: false }],
        }],
      },
      directory: {
        voiceChannels: [{ id: "voice", name: "Salon", occupants: [occupant(OLA)] }],
      },
    });

    render(<FriendsActivityContainer />);

    const rows = within(panel()).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Ola");
    expect(rows[0]).toHaveTextContent("Piszę muzykę");
    expect(rows[0]).toHaveTextContent("Salon · Orbit");
    expect(rows[1]).toHaveTextContent("Zosia");
    expect(rows[1]).toHaveTextContent("W rozmowie");
    expect(rows[2]).toHaveTextContent("Ada");
    expect(rows[2]).not.toHaveTextContent("W rozmowie");
  });

  it("updates the list as friends arrive, leave or stop a call", () => {
    setStubs({
      friends: { friends: [friend(ADA)] },
      directory: { voiceChannels: [{ id: "voice", name: "Salon", occupants: [occupant(ADA)] }] },
    });
    const { rerender } = render(<FriendsActivityContainer />);
    expect(screen.getByText("Salon · Orbit")).toBeInTheDocument();

    setStubs({ directory: { voiceChannels: [] } });
    rerender(<FriendsActivityContainer />);
    expect(screen.queryByText("W rozmowie")).not.toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();

    setStubs({ friends: { friends: [friend({ ...ADA, presence: "offline" })] } });
    rerender(<FriendsActivityContainer />);
    expect(screen.getByText("Na razie jest cicho")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();

    setStubs({ friends: { friends: [friend(OLA)] } });
    rerender(<FriendsActivityContainer />);
    expect(screen.getByText("Ola")).toBeInTheDocument();
    expect(screen.queryByText("Na razie jest cicho")).not.toBeInTheDocument();
  });

  it("opens the selected profile and starts a private message with that friend", async () => {
    const user = userEvent.setup();
    setStubs({ friends: { friends: [friend(ADA)] } });
    render(<FriendsActivityContainer />);

    const profile = screen.getByRole("button", { name: "Profil: Ada" });
    expect(profile).toHaveAccessibleDescription("W sieci");
    await user.click(profile);
    expect(stubs.profile.toggle).toHaveBeenCalledWith(ADA.id, profile);

    await user.click(screen.getByRole("button", { name: "Napisz do Ada" }));
    expect(stubs.friends.messagePerson).toHaveBeenCalledWith(ADA.id);
  });
});
