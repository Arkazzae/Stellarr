import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { AppContainer } from "./AppContainer";

const { providerNamed, standIn } = await vi.hoisted(async () => {
  const { createElement } = await import("react");
  return {
    /** A provider that only marks where it sits in the tree. */
    providerNamed: (name: string) =>
      function Provider({ children }: { children: unknown }) {
        return createElement("div", { "data-provider": name }, children as never);
      },
    standIn: (testId: string) =>
      function StandIn() {
        return createElement("div", { "data-testid": testId });
      },
  };
});

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);

vi.mock("@/components/primitives/ConfirmDialog", () => ({
  ConfirmProvider: providerNamed("Confirm"),
}));
vi.mock("@/state/AccountProvider", () => ({ AccountProvider: providerNamed("Account") }));
vi.mock("@/state/DirectoryProvider", () => ({ DirectoryProvider: providerNamed("Directory") }));
vi.mock("@/state/NotificationProvider", () => ({
  NotificationProvider: providerNamed("Notification"),
}));
vi.mock("@/state/EmojiProvider", () => ({ EmojiProvider: providerNamed("Emoji") }));
vi.mock("@/state/VoiceProvider", () => ({ VoiceProvider: providerNamed("Voice") }));
vi.mock("@/state/UiProvider", () => ({ UiProvider: providerNamed("Ui") }));
vi.mock("@/state/KeybindProvider", () => ({ KeybindProvider: providerNamed("Keybind") }));
vi.mock("@/state/FriendsProvider", () => ({ FriendsProvider: providerNamed("Friends") }));
vi.mock("@/state/ChatProvider", () => ({ ChatProvider: providerNamed("Chat") }));
vi.mock("@/state/ProfileProvider", () => ({ ProfileProvider: providerNamed("Profile") }));

vi.mock("./ServerRailContainer", () => ({ ServerRailContainer: standIn("server-rail") }));
vi.mock("./RailContainer", () => ({ RailContainer: standIn("channel-rail") }));
vi.mock("./DmRailContainer", () => ({ DmRailContainer: standIn("dm-rail") }));
vi.mock("./RoomContainer", () => ({ RoomContainer: standIn("channel-room") }));
vi.mock("./FriendsRoomContainer", () => ({ FriendsRoomContainer: standIn("friends-room") }));
vi.mock("./RosterContainer", () => ({ RosterContainer: standIn("roster") }));
vi.mock("./ModalsContainer", () => ({ ModalsContainer: standIn("modals") }));
vi.mock("./UserSettingsContainer", () => ({ UserSettingsContainer: standIn("user-settings") }));
vi.mock("./MiniProfileContainer", () => ({ MiniProfileContainer: standIn("mini-profile") }));
vi.mock("./IncomingCallContainer", () => ({ IncomingCallContainer: standIn("incoming-call") }));

beforeEach(() => {
  resetStubs();
  setStubs({ ui: { cinema: false, setCinema: vi.fn() } });
});

/** The providers above an element, outermost first. */
function providersAbove(element: HTMLElement): string[] {
  const names: string[] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    const name = node.getAttribute("data-provider");
    if (name) names.unshift(name);
  }
  return names;
}

describe("AppContainer", () => {
  it("nests the providers in dependency order", () => {
    render(<AppContainer />);

    expect(providersAbove(screen.getByTestId("channel-room"))).toEqual([
      "Confirm",
      "Account",
      "Directory",
      "Notification",
      "Emoji",
      "Voice",
      "Ui",
      "Keybind",
      "Friends",
      "Chat",
      "Profile",
    ]);
  });

  it("shows the channel rail, room and roster in server space", () => {
    render(<AppContainer />);

    expect(screen.getByTestId("server-rail")).toBeInTheDocument();
    expect(screen.getByTestId("channel-rail")).toBeInTheDocument();
    expect(screen.getByTestId("channel-room")).toBeInTheDocument();
    expect(screen.getByTestId("roster")).toBeInTheDocument();
    expect(screen.queryByTestId("dm-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("friends-room")).not.toBeInTheDocument();
    expect(screen.getByTestId("channel-room").closest(".app")).not.toHaveClass("dm-space");
  });

  it("swaps in the conversation rail and friends room, and drops the roster, in DM space", () => {
    setStubs({ ui: { space: "dm" } });
    render(<AppContainer />);

    expect(screen.getByTestId("dm-rail")).toBeInTheDocument();
    expect(screen.getByTestId("friends-room")).toBeInTheDocument();
    expect(screen.queryByTestId("channel-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("channel-room")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roster")).not.toBeInTheDocument();
    expect(screen.getByTestId("friends-room").closest(".app")).toHaveClass("dm-space");
  });

  it("mounts the overlays outside the grid", () => {
    render(<AppContainer />);

    for (const id of ["modals", "user-settings", "mini-profile", "incoming-call"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      expect(screen.getByTestId(id).closest(".app")).toBeNull();
    }
  });

  it("leaves full screen when Escape is pressed over the stage", async () => {
    setStubs({ ui: { cinema: true } });
    render(<AppContainer />);

    await userEvent.setup().keyboard("{Escape}");

    expect(stubs.ui.setCinema).toHaveBeenCalledWith(false);
  });
});
