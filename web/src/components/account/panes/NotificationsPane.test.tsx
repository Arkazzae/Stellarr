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
  mentionPopups: true,
  callRingtone: true,
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
  onAllow: vi.fn(),
  onChange: vi.fn(),
};

/** One cell's switch, named by its column and its event. */
function cell(outcome: "Dźwięk" | "Okienko" | "Skrzynka", event: string) {
  return screen.getByRole("switch", { name: `${outcome}: ${event}` });
}

/** One event's cells: a switch by its state, a fact by what a screen reader hears. */
function row(event: string): string[] {
  const header = screen.getByRole("rowheader", { name: new RegExp(event) });
  const tr = header.closest("tr");
  if (tr === null) throw new Error(`No row for ${event}`);
  return within(tr).getAllByRole("cell").map((td) => {
    const toggle = td.querySelector('[role="switch"]');
    if (toggle !== null) return toggle.getAttribute("aria-checked") === "true" ? "on" : "off";
    return td.textContent?.startsWith("Tak") ? "yes" : "no";
  });
}

function renderPane(props: Partial<Parameters<typeof UserNotificationsPane>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <UserNotificationsPane
      preferences={preferences}
      onChange={onChange}
      systemNotifications={system}
      {...props}
    />,
  );
  return { onChange, ...view };
}

describe("UserNotificationsPane", () => {
  it("offers only what the client delivers", () => {
    renderPane();

    expect(screen.queryByRole("switch", { name: "Powiadomienia push" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Powiadomienia e-mail" })).toBeNull();
    // Hearing others come and go is a sound of the call, on the sounds pane.
    expect(screen.queryByRole("switch", { name: "Dźwięk wejścia i wyjścia" })).toBeNull();
  });

  describe("what reaches you", () => {
    it("is a switch where a cell is a setting and a fact everywhere else", () => {
      renderPane();

      expect(screen.getByRole("columnheader", { name: "Co do Ciebie dociera" })).toBeInTheDocument();
      expect(row("Ada dzwoni")).toEqual(["on", "on", "no"]);
      expect(row("Nils oznacza Cię")).toEqual(["on", "on", "yes"]);
      expect(row("Nowa wiadomość")).toEqual(["off", "no", "no"]);
      expect(row("Wzmianka na wyciszonym kanale")).toEqual(["no", "no", "yes"]);
      expect(screen.getAllByRole("switch")).toHaveLength(5);
    });

    it("says why a fact cannot be changed", () => {
      renderPane();

      const tr = screen.getByRole("rowheader", { name: /Nils oznacza Cię/ }).closest("tr");
      if (tr === null) throw new Error("No mention row");
      expect(within(tr).getAllByRole("cell")[2]).toHaveTextContent("Wzmianka zawsze trafia do skrzynki.");
    });

    it("silences or rings a call", async () => {
      const user = userEvent.setup();
      const { onChange } = renderPane();

      await user.click(cell("Dźwięk", "Ada dzwoni"));

      expect(onChange).toHaveBeenCalledExactlyOnceWith({ callRingtone: false });
    });

    it("leaves the ringtone to the system where the system rings", () => {
      renderPane({ ringtone: false });

      expect(screen.queryByRole("switch", { name: "Dźwięk: Ada dzwoni" })).toBeNull();
      expect(row("Ada dzwoni")[0]).toBe("yes");
    });

    it("keeps every message including the mentions in the sound", async () => {
      const user = userEvent.setup();
      const { onChange, rerender } = renderPane();

      // Mentions only: every message turns the mentions on with it.
      await user.click(cell("Dźwięk", "Nowa wiadomość"));
      expect(onChange).toHaveBeenLastCalledWith({ messageSound: true, mentionsOnly: false });

      // Every message: the mentions off silences both.
      rerender(
        <UserNotificationsPane
          preferences={{ ...preferences, mentionsOnly: false }}
          onChange={onChange}
          systemNotifications={system}
        />,
      );
      expect(row("Nowa wiadomość")[0]).toBe("on");
      await user.click(cell("Dźwięk", "Nowa wiadomość"));
      expect(onChange).toHaveBeenLastCalledWith({ mentionsOnly: true });
      await user.click(cell("Dźwięk", "Nils oznacza Cię"));
      expect(onChange).toHaveBeenLastCalledWith({ messageSound: false });

      // Silent: the mentions come back on their own.
      rerender(
        <UserNotificationsPane
          preferences={{ ...preferences, messageSound: false, mentionsOnly: false }}
          onChange={onChange}
          systemNotifications={system}
        />,
      );
      expect(row("Nils oznacza Cię")[0]).toBe("off");
      expect(row("Nowa wiadomość")[0]).toBe("off");
      await user.click(cell("Dźwięk", "Nils oznacza Cię"));
      expect(onChange).toHaveBeenLastCalledWith({ messageSound: true, mentionsOnly: true });
    });

    it("switches call and mention pop-ups apart", async () => {
      const user = userEvent.setup();
      const onPopups = vi.fn();
      renderPane({ systemNotifications: { ...system, onChange: onPopups } });

      await user.click(cell("Okienko", "Nils oznacza Cię"));
      expect(onPopups).toHaveBeenLastCalledWith({ mentionPopups: false });
      await user.click(cell("Okienko", "Ada dzwoni"));
      expect(onPopups).toHaveBeenLastCalledWith({ desktopNotifications: false });
    });

    it("shows pop-ups off until the device agreed, and asks it from the cell", async () => {
      const user = userEvent.setup();
      const onPopups = vi.fn();
      renderPane({ systemNotifications: { ...system, permission: "default", onChange: onPopups } });

      expect(row("Ada dzwoni")[1]).toBe("off");
      await user.click(cell("Okienko", "Ada dzwoni"));

      expect(onPopups).toHaveBeenCalledExactlyOnceWith({ desktopNotifications: true });
    });

    it("turns pop-ups into facts where the device refused or cannot", () => {
      const { rerender } = renderPane({ systemNotifications: { ...system, permission: "denied" } });
      expect(screen.queryByRole("switch", { name: /^Okienko/ })).toBeNull();
      expect(screen.getAllByText(/Okienka są zablokowane w przeglądarce lub systemie\./).length)
        .toBeGreaterThan(0);

      rerender(
        <UserNotificationsPane
          preferences={preferences}
          onChange={vi.fn()}
          systemNotifications={{ ...system, mentions: false }}
        />,
      );
      expect(cell("Okienko", "Ada dzwoni")).toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "Okienko: Nils oznacza Cię" })).toBeNull();
      expect(row("Nils oznacza Cię")[1]).toBe("no");
      expect(screen.getByText(/Na tym urządzeniu wyskakują tylko połączenia\./)).toBeInTheDocument();
    });

    it("holds the pop-up switches while the device is asking", () => {
      renderPane({ systemNotifications: { ...system, permission: "default", pending: true } });

      expect(cell("Okienko", "Ada dzwoni")).toBeDisabled();
      expect(cell("Okienko", "Nils oznacza Cię")).toBeDisabled();
    });

    it("plays the message sound on request, and offers it only when it can", async () => {
      const user = userEvent.setup();
      const onPlaySound = vi.fn();
      const { rerender } = renderPane({ onPlaySound });

      await user.click(screen.getByRole("button", { name: "Odtwórz dźwięk wiadomości" }));
      expect(onPlaySound).toHaveBeenCalledOnce();

      rerender(<UserNotificationsPane preferences={preferences} onChange={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Odtwórz dźwięk wiadomości" })).toBeNull();
    });
  });

  describe("the device's permission", () => {
    it("asks to allow pop-ups before the device was asked", async () => {
      const user = userEvent.setup();
      const onAllow = vi.fn();
      renderPane({ systemNotifications: { ...system, permission: "default", onAllow } });

      expect(screen.getByText(/Urządzenie raz zapyta Cię o zgodę/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Zezwól na powiadomienia systemowe" }));

      expect(onAllow).toHaveBeenCalledOnce();
    });

    it("promises calls only where mentions cannot pop up", () => {
      renderPane({ systemNotifications: { ...system, permission: "default", mentions: false } });

      expect(screen.getByText(/^Połączenia wyskakują nad innymi/)).toBeInTheDocument();
    });

    it("holds the allow button while the device is asking", () => {
      renderPane({ systemNotifications: { ...system, permission: "default", pending: true } });

      expect(screen.getByRole("button", { name: "Zezwól na powiadomienia systemowe" })).toBeDisabled();
    });

    it("offers a test once allowed, and leaves the choice to the table", async () => {
      const user = userEvent.setup();
      const onTest = vi.fn();
      renderPane({ systemNotifications: { ...system, onTest } });

      expect(screen.getByText(/Dozwolone na tym urządzeniu/)).toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "Powiadomienia systemowe" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Wyślij próbne" }));

      expect(onTest).toHaveBeenCalledOnce();
    });

    it("says where to unblock them once the device refused", () => {
      renderPane({ systemNotifications: { ...system, permission: "denied" } });

      expect(screen.getByText("Zablokowane")).toBeInTheDocument();
      expect(screen.getByText(/w ustawieniach przeglądarki lub systemu\. Zezwól/)).toBeInTheDocument();
    });

    it("says when the device cannot show them, and why the last try failed", () => {
      renderPane({
        systemNotifications: { ...system, supported: false, permission: "unsupported", error: true },
      });

      expect(screen.getByText(/nie pokazuje powiadomień systemowych/)).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się włączyć powiadomień systemowych.");
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
      renderPane({ muted: { ...muted, onUnmute } });

      const list = screen.getByText("Wyciszone kanały").closest("section");
      if (list === null) throw new Error("No muted channels section");
      expect(within(list).getByText("memy")).toBeInTheDocument();
      expect(within(list).getByText("Luźne")).toBeInTheDocument();
      expect(within(list).queryByText(/poza tym serwerem/)).toBeNull();

      await user.click(within(list).getByRole("button", { name: "Wyłącz wyciszenie #memy" }));
      expect(onUnmute).toHaveBeenCalledExactlyOnceWith("c-memes");
    });

    it("counts the ones it cannot name and says how to mute when none are", () => {
      renderPane({ muted: { ...muted, channels: [], elsewhere: 3 } });

      expect(screen.getByText(/Na serwerze Stellarr nic nie jest wyciszone/)).toBeInTheDocument();
      expect(screen.getByText(/Wyciszone poza tym serwerem: 3\./)).toBeInTheDocument();
    });
  });
});
