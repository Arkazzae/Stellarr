import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UserPreferences } from "@/ports";

import {
  AdvancedPane,
  PrivacyPane,
  UserNotificationsPane,
  type SystemNotificationPreferenceProps,
} from "./PreferencePanes";

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

const system: SystemNotificationPreferenceProps = {
  supported: true,
  permission: "granted",
  pending: false,
  error: false,
  onChange: vi.fn(),
};

describe("UserNotificationsPane", () => {
  it("offers only the sounds the client delivers and writes each change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UserNotificationsPane preferences={preferences} supported onChange={onChange} />);

    expect(screen.queryByRole("button", { name: "Powiadomienia push" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Powiadomienia e-mail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tylko wzmianki" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Dźwięk wiadomości" }));
    await user.click(screen.getByRole("button", { name: "Dźwięk wejścia i wyjścia" }));

    expect(onChange).toHaveBeenCalledWith({ messageSound: false });
    expect(onChange).toHaveBeenCalledWith({ joinLeaveSound: false });
  });

  it("explains that nothing is stored and locks the switches", () => {
    render(<UserNotificationsPane preferences={preferences} supported={false} onChange={vi.fn()} />);

    expect(screen.getByText(/nie mają jeszcze swojej tabeli/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dźwięk wiadomości" })).toBeDisabled();
  });

  it("shows system notifications on only when the permission is granted too", () => {
    render(
      <UserNotificationsPane
        preferences={preferences}
        supported
        onChange={vi.fn()}
        systemNotifications={{ ...system, permission: "default" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Powiadomienia systemowe" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("hands the system switch to the browser permission flow", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <UserNotificationsPane
        preferences={{ ...preferences, desktopNotifications: false }}
        supported
        onChange={vi.fn()}
        systemNotifications={{ ...system, onChange }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Powiadomienia systemowe" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("says why system notifications cannot be switched on", () => {
    const { rerender } = render(
      <UserNotificationsPane
        preferences={preferences}
        supported
        onChange={vi.fn()}
        systemNotifications={{ ...system, permission: "denied" }}
      />,
    );
    expect(screen.getByText(/zablokowane w ustawieniach/)).toBeInTheDocument();

    rerender(
      <UserNotificationsPane
        preferences={preferences}
        supported
        onChange={vi.fn()}
        systemNotifications={{ ...system, supported: false, permission: "unsupported", error: true }}
      />,
    );
    expect(screen.getByText(/nie obsługuje powiadomień systemowych/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się włączyć powiadomień systemowych.");
    expect(screen.getByRole("button", { name: "Powiadomienia systemowe" })).toBeDisabled();
  });
});

describe("PrivacyPane", () => {
  it("writes each privacy switch under its own key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PrivacyPane preferences={preferences} supported onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Wiadomości prywatne od osób z serwera" }));
    await user.click(screen.getByRole("button", { name: "Zaproszenia do znajomych" }));
    await user.click(screen.getByRole("button", { name: "Pokazuj mój status" }));

    expect(onChange).toHaveBeenNthCalledWith(1, { allowDirectMessages: false });
    expect(onChange).toHaveBeenNthCalledWith(2, { allowFriendRequests: true });
    expect(onChange).toHaveBeenNthCalledWith(3, { showPresence: false });
  });

  it("says so once when the settings are not persisted", () => {
    render(<PrivacyPane preferences={preferences} supported={false} onChange={vi.fn()} />);

    expect(screen.getAllByText(/nie mają jeszcze swojej tabeli/)).toHaveLength(1);
  });
});

describe("AdvancedPane", () => {
  it("writes developer mode and reduced motion", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AdvancedPane preferences={preferences} supported onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Tryb dewelopera" }));
    await user.click(screen.getByRole("button", { name: "Ogranicz animacje" }));

    expect(onChange).toHaveBeenCalledWith({ developerMode: true });
    expect(onChange).toHaveBeenCalledWith({ reducedMotion: true });
  });

  it("leaves out system startup unless the desktop client supplies it", () => {
    render(<AdvancedPane preferences={preferences} supported onChange={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Uruchamiaj Stellarr wraz z systemem" })).toBeNull();
  });

  it("toggles system startup even while stored preferences are read-only", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AdvancedPane
        preferences={preferences}
        supported={false}
        onChange={vi.fn()}
        startup={{ enabled: false, pending: false, error: false, onChange }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Uruchamiaj Stellarr wraz z systemem" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByRole("button", { name: "Tryb dewelopera" })).toBeDisabled();
  });

  it("blocks the startup switch while a change is pending and reports a failure", () => {
    render(
      <AdvancedPane
        preferences={preferences}
        supported
        onChange={vi.fn()}
        startup={{ enabled: true, pending: true, error: true, onChange: vi.fn() }}
      />,
    );

    expect(screen.getByRole("button", { name: "Uruchamiaj Stellarr wraz z systemem" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się zmienić ustawienia autostartu");
  });
});
