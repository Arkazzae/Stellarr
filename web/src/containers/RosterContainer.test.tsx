import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";
import type { PersonVM } from "@/components/view-models";
import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { RosterContainer } from "./RosterContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);

function person(id: string, name: string, presence: PersonVM["presence"]): PersonVM {
  return { id, displayName: name, initials: name.slice(0, 2).toUpperCase(), presence };
}

const MAJA = person("u-maja", "Maja", "online");
const OLA = person("u-ola", "Ola", "online");
const KUBA = person("u-kuba", "Kuba", "idle");
const ZOSIA = person("u-zosia", "Zosia", "offline");

function renderRoster() {
  return render(
    <ConfirmProvider>
      <RosterContainer />
    </ConfirmProvider>,
  );
}

function groupOf(caption: string): HTMLElement {
  const group = screen.getByRole("heading", { name: new RegExp(caption) }).closest("section");
  if (group === null) throw new Error(`no roster group ${caption}`);
  return group;
}

async function openMenuOf(user: UserEvent, name: string) {
  const row = screen.getByText(name, { selector: ".roster-inner *" });
  await user.pointer({ keys: "[MouseRight]", target: row });
  return await screen.findByRole("menu");
}

beforeEach(() => {
  resetStubs();
  setStubs({
    directory: {
      people: [MAJA, OLA, KUBA, ZOSIA],
      inVoice: [],
    },
  });
});

afterEach(() => {
  window.innerWidth = 1024;
});

describe("RosterContainer", () => {
  it("groups people by presence alone", () => {
    renderRoster();

    expect(within(groupOf("W sieci")).getAllByText(/^(Maja|Ola|Kuba)$/)).toHaveLength(3);
    expect(within(groupOf("Poza siecią")).getByText("Zosia")).toBeInTheDocument();
  });

  it("rings the speaker in a call without moving them out of their group", () => {
    setStubs({ directory: { inVoice: [OLA] } });
    stubs.voice.applySpeaking = vi.fn((people: PersonVM[]) =>
      people.map((entry) => ({ ...entry, speaking: true })),
    );
    renderRoster();

    const online = groupOf("W sieci");
    expect(within(online).getByText("Ola").closest(".speaking")).not.toBeNull();
    expect(within(online).getByText("Maja").closest(".speaking")).toBeNull();
  });

  it("is a live panel on the server and leaves the tab order in a conversation", () => {
    const { container, rerender } = renderRoster();
    expect(container.querySelector("aside")).not.toHaveAttribute("inert");

    setStubs({ ui: { space: "dm" } });
    rerender(
      <ConfirmProvider>
        <RosterContainer />
      </ConfirmProvider>,
    );
    expect(container.querySelector("aside")).toHaveAttribute("inert");
  });

  it("collapses to the avatar column on a wide screen and goes away on a narrow one", () => {
    setStubs({ ui: { rosterOpen: false } });
    const wide = renderRoster();
    expect(wide.container.querySelector("aside")).not.toHaveAttribute("inert");
    wide.unmount();

    window.innerWidth = 800;
    const narrow = renderRoster();
    expect(narrow.container.querySelector("aside")).toHaveAttribute("inert");
  });

  it("opens and closes the panel through the ui", async () => {
    const user = userEvent.setup();
    renderRoster();

    await user.click(screen.getByRole("button", { name: "Zwiń panel osób" }));
    await user.click(screen.getByRole("button", { name: "Rozwiń panel osób" }));

    expect(stubs.ui.setRosterOpen).toHaveBeenNthCalledWith(1, false);
    expect(stubs.ui.setRosterOpen).toHaveBeenNthCalledWith(2, true);
  });

  describe("person menu", () => {
    it("sends the friend request for the person whose row was clicked", async () => {
      const user = userEvent.setup();
      renderRoster();

      const menu = await openMenuOf(user, "Ola");
      await user.click(within(menu).getByRole("menuitem", { name: "Dodaj do znajomych" }));

      expect(stubs.friends.addFriend).toHaveBeenCalledTimes(1);
      expect(stubs.friends.addFriend).toHaveBeenCalledWith("Ola");
    });

    it("offers the friendship item that matches where you stand", async () => {
      setStubs({
        friends: {
          friends: [{ user: { id: "u-ola" }, since: "2026-01-01T00:00:00.000Z" } as never],
        },
      });
      const user = userEvent.setup();
      renderRoster();

      const menu = await openMenuOf(user, "Ola");

      expect(within(menu).getByRole("menuitem", { name: "Usuń ze znajomych" })).toBeInTheDocument();
      expect(within(menu).queryByRole("menuitem", { name: "Dodaj do znajomych" })).toBeNull();
    });

    it("treats your own row as yours: no messaging yourself", async () => {
      const user = userEvent.setup();
      renderRoster();

      const menu = await openMenuOf(user, "Maja");

      expect(within(menu).queryByRole("menuitem", { name: "Wyślij wiadomość" })).toBeNull();
    });

    it("offers moderation only to a member who holds the permission, on an adapter that can act", async () => {
      const user = userEvent.setup();
      const first = renderRoster();

      // The permission without an endpoint behind it.
      setStubs({ directory: { canModerateMembers: true, canManageBans: true } });
      first.rerender(
        <ConfirmProvider>
          <RosterContainer />
        </ConfirmProvider>,
      );
      let menu = await openMenuOf(user, "Ola");
      expect(within(menu).queryByRole("menuitem", { name: "Wyrzuć z serwera" })).toBeNull();
      expect(within(menu).queryByRole("menuitem", { name: "Zbanuj" })).toBeNull();
      await user.keyboard("{Escape}");
      first.unmount();

      // The endpoint without the permission.
      setStubs({
        directory: { canModerateMembers: false, canManageBans: false },
        ports: {
          admin: { ...stubs.ports.admin, supported: { ...stubs.ports.admin.supported, moderation: true } },
        },
      });
      const second = renderRoster();
      menu = await openMenuOf(user, "Ola");
      expect(within(menu).queryByRole("menuitem", { name: "Wyrzuć z serwera" })).toBeNull();
      second.unmount();

      // Each permission unlocks its own item.
      setStubs({ directory: { canModerateMembers: true } });
      renderRoster();
      menu = await openMenuOf(user, "Ola");
      expect(within(menu).getByRole("menuitem", { name: "Wyrzuć z serwera" })).toBeInTheDocument();
      expect(within(menu).queryByRole("menuitem", { name: "Zbanuj" })).toBeNull();
    });

    describe("with permission to moderate", () => {
      beforeEach(() => {
        setStubs({
          directory: { canModerateMembers: true, canManageBans: true },
          ports: {
            admin: {
              ...stubs.ports.admin,
              supported: { ...stubs.ports.admin.supported, moderation: true },
            },
          },
        });
      });

      it("kicks once the dialog is confirmed", async () => {
        const user = userEvent.setup();
        renderRoster();

        const menu = await openMenuOf(user, "Ola");
        await user.click(within(menu).getByRole("menuitem", { name: "Wyrzuć z serwera" }));
        expect(stubs.ports.admin.kick).not.toHaveBeenCalled();
        await user.click(await screen.findByRole("button", { name: "Wyrzuć" }));

        expect(stubs.ports.admin.kick).toHaveBeenCalledWith("u-ola");
      });

      it("bans without a reason when none is typed", async () => {
        const user = userEvent.setup();
        renderRoster();

        const menu = await openMenuOf(user, "Ola");
        await user.click(within(menu).getByRole("menuitem", { name: "Zbanuj" }));
        await user.click(await screen.findByRole("button", { name: "Zbanuj" }));

        expect(stubs.ports.admin.ban).toHaveBeenCalledWith("u-ola", undefined);
      });

      it("passes the reason along when one is typed", async () => {
        const user = userEvent.setup();
        renderRoster();

        const menu = await openMenuOf(user, "Ola");
        await user.click(within(menu).getByRole("menuitem", { name: "Zbanuj" }));
        await user.type(await screen.findByLabelText("POWÓD"), "spam");
        await user.click(screen.getByRole("button", { name: "Zbanuj" }));

        expect(stubs.ports.admin.ban).toHaveBeenCalledWith("u-ola", "spam");
      });
    });
  });
});
