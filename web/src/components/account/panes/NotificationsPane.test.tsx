import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UserPreferences } from "@/ports";

import {
  UserNotificationsPane,
  type MutedChannelsProps,
  type SystemNotificationPreferenceProps,
} from "./NotificationsPane";

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
  mentions: true,
  onChange: vi.fn(),
};

/** The marks of one example row, as a screen reader reads them: sound, pop-up, inbox. */
function outcomes(example: string): string[] {
  const row = screen.getByRole("rowheader", { name: new RegExp(example) }).closest("tr");
  if (row === null) throw new Error(`No row for ${example}`);
  return within(row).getAllByRole("cell").map((cell) => cell.textContent ?? "");
}

describe("UserNotificationsPane", () => {
  it("offers only what the client delivers", () => {
    render(<UserNotificationsPane preferences={preferences} onChange={vi.fn()} />);

    expect(screen.queryByRole("switch", { name: "Powiadomienia push" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Powiadomienia e-mail" })).toBeNull();
    // Hearing others come and go is a sound of the call, on the sounds pane.
    expect(screen.queryByRole("switch", { name: "Dźwięk wejścia i wyjścia" })).toBeNull();
  });

  describe("what reaches you", () => {
    it("draws the settings as outcomes, a mention always reaching the inbox", () => {
      render(
        <UserNotificationsPane
          preferences={preferences}
          onChange={vi.fn()}
          systemNotifications={system}
        />,
      );

      expect(screen.getByRole("columnheader", { name: "Co do Ciebie dociera" })).toBeInTheDocument();
      expect(outcomes("Ada dzwoni")).toEqual(["Tak", "Tak", "Nie"]);
      expect(outcomes("Nils oznacza Cię")).toEqual(["Tak", "Tak", "Tak"]);
      expect(outcomes("Nowa wiadomość")).toEqual(["Nie", "Nie", "Nie"]);
      expect(outcomes("Wzmianka na wyciszonym kanale")).toEqual(["Nie", "Nie", "Tak"]);
    });

    it("follows the sound choice and the permission", () => {
      const { rerender } = render(
        <UserNotificationsPane
          preferences={{ ...preferences, mentionsOnly: false }}
          onChange={vi.fn()}
          systemNotifications={{ ...system, permission: "default" }}
        />,
      );
      expect(outcomes("Nowa wiadomość")).toEqual(["Tak", "Nie", "Nie"]);
      expect(outcomes("Ada dzwoni")).toEqual(["Tak", "Nie", "Nie"]);

      rerender(
        <UserNotificationsPane
          preferences={{ ...preferences, messageSound: false }}
          onChange={vi.fn()}
          systemNotifications={system}
        />,
      );
      expect(outcomes("Nils oznacza Cię")).toEqual(["Nie", "Tak", "Tak"]);
      expect(outcomes("Nowa wiadomość")).toEqual(["Nie", "Nie", "Nie"]);
    });

    it("keeps a mention in the app where the device pops up calls only", () => {
      render(
        <UserNotificationsPane
          preferences={preferences}
          onChange={vi.fn()}
          systemNotifications={{ ...system, mentions: false }}
        />,
      );

      expect(outcomes("Ada dzwoni")).toEqual(["Tak", "Tak", "Nie"]);
      expect(outcomes("Nils oznacza Cię")).toEqual(["Tak", "Nie", "Tak"]);
      expect(screen.getByText(/^Połączenia wyskakują nad innymi/)).toBeInTheDocument();
    });
  });

  describe("message sound", () => {
    it("is one choice of three, written as the two stored preferences", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<UserNotificationsPane preferences={preferences} onChange={onChange} />);

      const choice = screen.getByRole("radiogroup", { name: "Kiedy grać" });
      expect(within(choice).getByRole("radio", { name: /Wzmianki/ })).toBeChecked();

      await user.click(within(choice).getByRole("radio", { name: /Wszystkie wiadomości/ }));
      expect(onChange).toHaveBeenLastCalledWith({ messageSound: true, mentionsOnly: false });

      await user.click(within(choice).getByRole("radio", { name: /Wyłączony/ }));
      expect(onChange).toHaveBeenLastCalledWith({ messageSound: false });
    });

    it("shows a silenced sound as off, whatever it was for", () => {
      render(
        <UserNotificationsPane
          preferences={{ ...preferences, messageSound: false, mentionsOnly: false }}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole("radio", { name: /Wyłączony/ })).toBeChecked();
    });

    it("plays the sound on request, and offers it only when it can", async () => {
      const user = userEvent.setup();
      const onPlaySound = vi.fn();
      const { rerender } = render(
        <UserNotificationsPane preferences={preferences} onChange={vi.fn()} onPlaySound={onPlaySound} />,
      );

      await user.click(screen.getByRole("button", { name: "Odtwórz dźwięk wiadomości" }));
      expect(onPlaySound).toHaveBeenCalledOnce();

      rerender(<UserNotificationsPane preferences={preferences} onChange={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Odtwórz dźwięk wiadomości" })).toBeNull();
    });
  });

  describe("system notifications", () => {
    function renderSystem(props: Partial<SystemNotificationPreferenceProps>, prefs = preferences) {
      return render(
        <UserNotificationsPane
          preferences={prefs}
          onChange={vi.fn()}
          systemNotifications={{ ...system, ...props }}
        />,
      );
    }

    it("asks to allow them before the device was asked, rather than showing a switch", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderSystem({ permission: "default", onChange });

      expect(screen.queryByRole("switch", { name: "Powiadomienia systemowe" })).toBeNull();
      expect(screen.getByText(/Urządzenie raz zapyta Cię o zgodę/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Zezwól na powiadomienia systemowe" }));

      expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    });

    it("holds the allow button while the device is asking", () => {
      renderSystem({ permission: "default", pending: true });

      expect(screen.getByRole("button", { name: "Zezwól na powiadomienia systemowe" })).toBeDisabled();
    });

    it("switches them once allowed, with a test beside a switch that is on", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onTest = vi.fn();
      const { rerender } = renderSystem({ onChange, onTest });

      const toggle = screen.getByRole("switch", { name: "Powiadomienia systemowe" });
      expect(toggle).toHaveAttribute("aria-checked", "true");
      await user.click(screen.getByRole("button", { name: "Wyślij próbne" }));
      expect(onTest).toHaveBeenCalledOnce();
      await user.click(toggle);
      expect(onChange).toHaveBeenCalledExactlyOnceWith(false);

      rerender(
        <UserNotificationsPane
          preferences={{ ...preferences, desktopNotifications: false }}
          onChange={vi.fn()}
          systemNotifications={{ ...system, onTest }}
        />,
      );
      expect(screen.queryByRole("button", { name: "Wyślij próbne" })).toBeNull();
    });

    it("says where to unblock them once the device refused", () => {
      renderSystem({ permission: "denied" });

      expect(screen.queryByRole("switch", { name: "Powiadomienia systemowe" })).toBeNull();
      expect(screen.getByText("Zablokowane")).toBeInTheDocument();
      expect(screen.getByText(/w ustawieniach przeglądarki lub systemu/)).toBeInTheDocument();
    });

    it("says when the device cannot show them, and why the last try failed", () => {
      renderSystem({ supported: false, permission: "unsupported", error: true });

      expect(screen.getByText(/nie pokazuje powiadomień systemowych/)).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się włączyć powiadomień systemowych.");
      expect(screen.queryByRole("switch", { name: "Powiadomienia systemowe" })).toBeNull();
    });
  });

  describe("muted channels", () => {
    const muted: MutedChannelsProps = {
      serverName: "Stellarr",
      channels: [
        { id: "c-memes", name: "memy", section: "Luźne" },
        { id: "c-log", name: "log" },
      ],
      elsewhere: 0,
      onUnmute: vi.fn(),
    };

    it("lists them with the one way back", async () => {
      const user = userEvent.setup();
      const onUnmute = vi.fn();
      render(
        <UserNotificationsPane
          preferences={preferences}
          onChange={vi.fn()}
          muted={{ ...muted, onUnmute }}
        />,
      );

      const list = screen.getByText("Wyciszone kanały").closest("section");
      if (list === null) throw new Error("No muted channels section");
      expect(within(list).getByText("memy")).toBeInTheDocument();
      expect(within(list).getByText("Luźne")).toBeInTheDocument();
      expect(within(list).queryByText(/poza tym serwerem/)).toBeNull();

      await user.click(within(list).getByRole("button", { name: "Wyłącz wyciszenie #memy" }));
      expect(onUnmute).toHaveBeenCalledExactlyOnceWith("c-memes");
    });

    it("counts the ones it cannot name and says how to mute when none are", () => {
      render(
        <UserNotificationsPane
          preferences={preferences}
          onChange={vi.fn()}
          muted={{ ...muted, channels: [], elsewhere: 3 }}
        />,
      );

      expect(screen.getByText(/Na serwerze Stellarr nic nie jest wyciszone/)).toBeInTheDocument();
      expect(screen.getByText(/Wyciszone poza tym serwerem: 3\./)).toBeInTheDocument();
    });
  });
});
