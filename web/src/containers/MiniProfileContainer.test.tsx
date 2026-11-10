import { act, render, screen, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/ports";
import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { MiniProfileContainer } from "./MiniProfileContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);

const ADA: User = {
  id: "u-ada",
  username: "ada",
  displayName: "Ada",
  presence: "online",
  bio: "Buduję rzeczy.",
  pronouns: "ona/jej",
};

function openCard(userId: string, autoFocus = true) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  setStubs({ profile: { open: { userId, anchor, autoFocus } } });
}

/** Lets the admin port answer, so its late state update lands inside `act`. */
async function renderCard() {
  const view = render(<MiniProfileContainer />);
  await act(async () => {});
  return view;
}

/** Closes the card and opens it again, the way two clicks on a roster row do. */
async function reopen(view: RenderResult, userId: string) {
  setStubs({ profile: { open: null } });
  view.rerender(<MiniProfileContainer />);
  openCard(userId);
  await act(async () => view.rerender(<MiniProfileContainer />));
}

beforeEach(() => {
  resetStubs();
  setStubs({ directory: { members: [ADA] } });
});

describe("MiniProfileContainer", () => {
  it("renders nothing while no card is open", async () => {
    const { container } = await renderCard();

    expect(container).toBeEmptyDOMElement();
  });

  it("resolves the open person from the directory", async () => {
    openCard("u-ada");
    await renderCard();

    expect(screen.getByRole("dialog", { name: "Profil: Ada" })).toBeInTheDocument();
    expect(screen.getByText("@ada")).toBeInTheDocument();
    expect(screen.getByText("Buduję rzeczy.")).toBeInTheDocument();
    expect(screen.getByText("ona/jej")).toBeInTheDocument();
  });

  it("finds a friend who is not on this server through the friends graph", async () => {
    const remote: User = { id: "u-remote", username: "zdalny", displayName: "Zdalny", presence: "idle" };
    setStubs({
      friends: { friends: [{ user: remote, since: "2026-03-03T10:00:00.000Z" }] },
    });
    openCard("u-remote");
    await renderCard();

    expect(screen.getByRole("dialog", { name: "Profil: Zdalny" })).toBeInTheDocument();
    expect(screen.getByText(/3 marca 2026/)).toBeInTheDocument();
  });

  it("renders nothing for somebody no source knows", async () => {
    openCard("u-nobody");
    const { container } = await renderCard();

    expect(container).toBeEmptyDOMElement();
  });

  it("names the voice channel they are in", async () => {
    setStubs({
      directory: {
        voiceChannels: [
          {
            id: "c-salon",
            name: "Salon",
            occupants: [{ id: "u-ada", displayName: "Ada", initials: "AD", presence: "online" }],
          },
        ],
      },
    });
    openCard("u-ada");
    await renderCard();

    expect(screen.getByText("Salon")).toBeInTheDocument();
  });

  describe("roles and join date", () => {
    beforeEach(() => {
      vi.mocked(stubs.ports.admin.listMembers).mockResolvedValue([
        { user: ADA, roleId: "r-mod", joinedAt: "2026-07-12T10:00:00.000Z" },
      ]);
      vi.mocked(stubs.ports.admin.listRoles).mockResolvedValue([
        { id: "r-mod", name: "Moderator", color: "#ff6b6b" } as never,
      ]);
    });

    it("come from the admin port once the card has opened", async () => {
      openCard("u-ada");
      await renderCard();

      expect(await screen.findByText("Moderator")).toBeInTheDocument();
      expect(screen.getByText(/12 lipca 2026/)).toBeInTheDocument();
    });

    it("are asked for once, however many cards open", async () => {
      openCard("u-ada");
      const view = await renderCard();
      await screen.findByText("Moderator");

      await reopen(view, "u-ada");

      expect(stubs.ports.admin.listMembers).toHaveBeenCalledTimes(1);
      expect(stubs.ports.admin.listRoles).toHaveBeenCalledTimes(1);
    });

    it("are not asked for before a card opens", async () => {
      await renderCard();

      expect(stubs.ports.admin.listMembers).not.toHaveBeenCalled();
    });
  });

  it("renders the card without them when the admin port fails, and asks again next time", async () => {
    vi.mocked(stubs.ports.admin.listMembers).mockRejectedValueOnce(new Error("offline"));
    openCard("u-ada");
    const view = await renderCard();

    expect(await screen.findByRole("dialog", { name: "Profil: Ada" })).toBeInTheDocument();
    await vi.waitFor(() => expect(stubs.ports.admin.listMembers).toHaveBeenCalledTimes(1));

    // A rejected ask leaves the door open for the next card.
    await reopen(view, "u-ada");

    await vi.waitFor(() => expect(stubs.ports.admin.listMembers).toHaveBeenCalledTimes(2));
  });

  it("renders the card when the admin port throws before it answers", async () => {
    vi.mocked(stubs.ports.admin.listMembers).mockImplementationOnce(() => {
      throw new Error("not wired");
    });
    openCard("u-ada");
    await renderCard();

    expect(screen.getByRole("dialog", { name: "Profil: Ada" })).toBeInTheDocument();
  });

  describe("actions", () => {
    it("send what was typed and close the card", async () => {
      const user = userEvent.setup();
      openCard("u-ada");
      await renderCard();

      await user.type(screen.getByLabelText("Napisz do Ada"), "cześć{Enter}");

      expect(stubs.friends.messagePerson).toHaveBeenCalledWith("u-ada", "cześć");
      expect(stubs.profile.close).toHaveBeenCalled();
    });

    it("invite by username and close the card", async () => {
      const user = userEvent.setup();
      openCard("u-ada");
      await renderCard();

      await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie do Ada" }));

      expect(stubs.friends.addFriend).toHaveBeenCalledWith("ada");
      expect(stubs.profile.close).toHaveBeenCalled();
    });

    it("answer a pending invitation by its request id", async () => {
      const user = userEvent.setup();
      setStubs({
        friends: {
          requests: [
            { id: "req-7", user: ADA, direction: "incoming", sentAt: "2026-01-01T00:00:00.000Z" },
          ],
        },
      });
      openCard("u-ada");
      await renderCard();

      await user.click(screen.getByRole("button", { name: "Przyjmij zaproszenie od Ada" }));

      expect(stubs.friends.accept).toHaveBeenCalledWith("req-7");
      expect(stubs.profile.close).toHaveBeenCalled();
    });

    it("open the account settings from your own card", async () => {
      const user = userEvent.setup();
      setStubs({ session: { user: ADA } });
      openCard("u-ada");
      await renderCard();

      await user.click(screen.getByRole("button", { name: "Edytuj swój profil" }));

      expect(stubs.ui.openModal).toHaveBeenCalledWith("account");
      expect(stubs.profile.close).toHaveBeenCalled();
    });
  });
});
