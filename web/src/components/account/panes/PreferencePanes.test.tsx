import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UserPreferences } from "@/ports";

import { AdvancedPane, PrivacyPane } from "./PreferencePanes";

const preferences: UserPreferences = {
  desktopNotifications: true,
  emailNotifications: false,
  pushNotifications: false,
  mentionsOnly: true,
  messageSound: true,
  joinLeaveSound: true,
  allowDirectMessages: true,
  allowFriendRequests: false,
  showPresence: true,
  developerMode: false,
  reducedMotion: false,
  mutedChannelIds: [],
  vadSensitivity: 60,
  joinSoundId: null,
};

describe("PrivacyPane", () => {
  it("writes each privacy switch under its own key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PrivacyPane preferences={preferences} onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Wiadomości prywatne od osób z serwera" }));
    await user.click(screen.getByRole("switch", { name: "Zaproszenia do znajomych" }));
    await user.click(screen.getByRole("switch", { name: "Pokazuj moją dostępność" }));

    expect(onChange).toHaveBeenNthCalledWith(1, { allowDirectMessages: false });
    expect(onChange).toHaveBeenNthCalledWith(2, { allowFriendRequests: true });
    expect(onChange).toHaveBeenNthCalledWith(3, { showPresence: false });
  });

  it("lists the blocked people and unblocks the one asked for", async () => {
    const user = userEvent.setup();
    const onUnblock = vi.fn();
    render(
      <PrivacyPane
        preferences={preferences}
        onChange={vi.fn()}
        blocked={{
          people: [
            { id: "u-ola", displayName: "Ola", username: "ola" },
            { id: "u-nils", displayName: "", username: "nils" },
          ],
          onUnblock,
        }}
      />,
    );

    expect(screen.getByText("@ola")).toBeVisible();
    // Without a display name the handle stands in for it.
    expect(screen.getByText("nils")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Odblokuj: nils" }));

    expect(onUnblock).toHaveBeenCalledExactlyOnceWith("u-nils");
  });

  it("says where blocking happens when nobody is blocked", () => {
    render(
      <PrivacyPane preferences={preferences} onChange={vi.fn()} blocked={{ people: [], onUnblock: vi.fn() }} />,
    );

    expect(screen.getByText(/Nikogo nie blokujesz/)).toBeVisible();
  });
});

describe("AdvancedPane", () => {
  it("writes developer mode, and leaves motion to the appearance pane", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdvancedPane preferences={preferences} onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Tryb dewelopera" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ developerMode: true });
    expect(screen.queryByRole("switch", { name: "Ogranicz animacje" })).toBeNull();
  });

  it("leaves out system startup unless the desktop client supplies it", () => {
    render(<AdvancedPane preferences={preferences} onChange={vi.fn()} />);

    expect(screen.queryByRole("switch", { name: "Uruchamiaj Stellarr wraz z systemem" })).toBeNull();
  });

  it("toggles system startup", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AdvancedPane
        preferences={preferences}
        onChange={vi.fn()}
        startup={{ enabled: false, pending: false, error: false, onChange }}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Uruchamiaj Stellarr wraz z systemem" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("blocks the startup switch while a change is pending and reports a failure", () => {
    render(
      <AdvancedPane
        preferences={preferences}
        onChange={vi.fn()}
        startup={{ enabled: true, pending: true, error: true, onChange: vi.fn() }}
      />,
    );

    expect(screen.getByRole("switch", { name: "Uruchamiaj Stellarr wraz z systemem" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się zmienić ustawienia autostartu");
  });
});
