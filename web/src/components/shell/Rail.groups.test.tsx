import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";

import { Rail, type RailProps } from "./Rail";

function setup(overrides: Partial<RailProps> = {}) {
  const props: RailProps = {
    serverName: "Orbit",
    textChannels: [
      { id: "t-1", name: "ogólny" },
      { id: "t-2", name: "plany", sectionId: "s-1" },
    ],
    voiceChannels: [
      { id: "v-1", name: "Salon", occupants: [] },
      { id: "v-2", name: "Sesja", occupants: [], sectionId: "s-1" },
    ],
    sections: [
      { id: "s-1", name: "Gry" },
      { id: "s-2", name: "Archiwum" },
    ],
    activeChannelId: null,
    selfId: "me",
    onSelectTextChannel: vi.fn(),
    onJoinVoiceChannel: vi.fn(),
    onEditServer: vi.fn(),
    onInvite: vi.fn(),
    onReorderChannelGroup: vi.fn(),
    ...overrides,
  };
  render(
    <ConfirmProvider>
      <Rail {...props} />
    </ConfirmProvider>,
  );
  return props;
}

/** The section a caption heads, found by the name it prints. */
function section(name: string): HTMLElement {
  const root = screen.getByText(name).closest(".rail-section");
  if (!(root instanceof HTMLElement)) throw new Error(`No section ${name}`);
  return root;
}

describe("Rail sections", () => {
  it("keeps a channel under its own section and out of the plain groups", () => {
    setup();

    const gry = section("Gry");
    expect(within(gry).getByText("plany")).toBeInTheDocument();
    expect(within(gry).getByText("Sesja")).toBeInTheDocument();
    expect(within(gry).queryByText("ogólny")).toBeNull();
    expect(within(gry).queryByText("Salon")).toBeNull();
    expect(screen.getAllByText("plany")).toHaveLength(1);
  });

  it("says so when a section holds no channel", () => {
    setup();

    expect(
      within(section("Archiwum")).getByText("Ta sekcja jest jeszcze pusta."),
    ).toBeInTheDocument();
    expect(
      within(section("Gry")).queryByText("Ta sekcja jest jeszcze pusta."),
    ).toBeNull();
  });

  it("collapses one section without touching the others", async () => {
    const user = userEvent.setup();
    setup();

    const caption = within(section("Gry")).getByRole("button", { name: /Gry/ });
    expect(caption).toHaveAttribute("aria-expanded", "true");

    await user.click(caption);

    const row = within(section("Gry")).getByRole("button", { name: "plany" });
    expect(caption).toHaveAttribute("aria-expanded", "false");
    // jsdom does not compute inertness, so the ancestor stands in for it.
    expect(row.closest("[inert]")).not.toBeNull();
    expect(
      within(section("Archiwum")).getByRole("button", { name: /Archiwum/ }),
    ).toHaveAttribute("aria-expanded", "true");

    await user.click(caption);
    expect(row.closest("[inert]")).toBeNull();
  });

  it("offers a section's settings only to someone who manages channels", async () => {
    const user = userEvent.setup();
    const { onOpenSectionSettings } = setup({
      canManageChannels: true,
      onOpenSectionSettings: vi.fn(),
    });

    await user.click(
      screen.getByRole("button", { name: "Ustawienia sekcji Archiwum" }),
    );
    expect(onOpenSectionSettings).toHaveBeenCalledWith("s-2");
  });

  it("shows no section settings to a member", () => {
    setup({ onOpenSectionSettings: vi.fn() });

    expect(screen.queryByRole("button", { name: /Ustawienia sekcji/ })).toBeNull();
  });
});

describe("Rail channel management", () => {
  it("creates a channel of the kind named by the caption's plus", async () => {
    const user = userEvent.setup();
    const { onCreateChannel } = setup({
      canManageChannels: true,
      onCreateChannel: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "Utwórz kanał tekstowy" }));
    expect(onCreateChannel).toHaveBeenLastCalledWith("text");
    await user.click(screen.getByRole("button", { name: "Utwórz kanał głosowy" }));
    expect(onCreateChannel).toHaveBeenLastCalledWith("voice");
  });

  it("hides creation and channel cogs from a member", () => {
    setup({ onCreateChannel: vi.fn(), onOpenChannelSettings: vi.fn() });

    expect(screen.queryByRole("button", { name: /Utwórz kanał/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ustawienia kanału/ })).toBeNull();
  });

  it("opens the settings of the row whose cog was pressed", async () => {
    const user = userEvent.setup();
    const { onOpenChannelSettings } = setup({
      canManageChannels: true,
      onOpenChannelSettings: vi.fn(),
    });

    await user.click(
      screen.getByRole("button", { name: "Ustawienia kanału: Sesja" }),
    );
    expect(onOpenChannelSettings).toHaveBeenCalledWith("v-2");
  });

  it("opens and joins channels by their kind", async () => {
    const user = userEvent.setup();
    const { onSelectTextChannel, onJoinVoiceChannel } = setup();

    await user.click(screen.getByRole("button", { name: "ogólny" }));
    await user.click(screen.getByRole("button", { name: /Sesja/ }));

    expect(onSelectTextChannel).toHaveBeenCalledWith("t-1");
    expect(onJoinVoiceChannel).toHaveBeenCalledWith("v-2");
  });
});

describe("Rail frame", () => {
  it("puts the call controls above the account row", () => {
    setup({
      voiceDock: <div data-testid="dock" />,
      account: <div data-testid="account" />,
    });

    const dock = screen.getByTestId("dock");
    const account = screen.getByTestId("account");
    expect(dock.compareDocumentPosition(account)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("takes a closed drawer out of the accessibility tree and the tab order", () => {
    setup({ hidden: true });

    expect(
      screen.getByRole("button", { name: "ogólny" }).closest("[inert]"),
    ).not.toBeNull();
  });

  it("does not pull focus into a closed drawer when a thread opens", () => {
    const thread = {
      id: "root-1",
      channelId: "t-1",
      authorName: "Maja",
      preview: "Plan",
      replyCount: 1,
    };
    setup({
      hidden: true,
      activeChannelId: "t-1",
      activeThreadId: "root-1",
      threadsByChannel: { "t-1": [thread] },
    });

    expect(document.body).toHaveFocus();
  });
});

describe("Rail thread focus", () => {
  const thread = {
    id: "root-1",
    channelId: "t-1",
    authorName: "Maja",
    preview: "Plan",
    replyCount: 1,
  };

  it("leaves focus alone when the channel holding the open thread changes section", () => {
    const rail = (sectionId?: string) => (
      <ConfirmProvider>
        <Rail
          serverName="Orbit"
          textChannels={[
            { id: "t-1", name: "ogólny", sectionId },
            { id: "t-2", name: "plany" },
          ]}
          voiceChannels={[]}
          sections={[{ id: "s-1", name: "Gry" }]}
          activeChannelId="t-1"
          activeThreadId="root-1"
          threadsByChannel={{ "t-1": [thread] }}
          selfId="me"
          onSelectTextChannel={vi.fn()}
          onJoinVoiceChannel={vi.fn()}
          onEditServer={vi.fn()}
          onInvite={vi.fn()}
          onReorderChannelGroup={vi.fn()}
        />
      </ConfirmProvider>
    );
    const { rerender } = render(rail());
    expect(
      screen.getByRole("button", { name: /Otwórz wątek/ }),
    ).toHaveFocus();

    const elsewhere = screen.getByRole("button", { name: "plany" });
    act(() => elsewhere.focus());
    rerender(rail("s-1"));

    expect(
      within(section("Gry")).getByRole("button", { name: /Otwórz wątek/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "plany" })).toHaveFocus();
  });
});
