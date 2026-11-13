import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserSettingsProps } from "@/components/account/UserSettings";
import { DEFAULT_SETTINGS, type VoiceSettings } from "@/lib/voice/settings";
import type { DesktopPort } from "@/ports";

import { UserSettingsContainer } from "./UserSettingsContainer";

/**
 * The container is wiring, so the dialog and every provider behind it are
 * replaced: what is checked is what it hands to the dialog and what it does
 * when the dialog calls back.
 */
const world = vi.hoisted(() => ({
  shown: null as unknown,
  modal: null as string | null,
  closeModal: vi.fn(),
  logout: vi.fn(async () => undefined),
  account: {} as Record<string, unknown>,
  ports: {} as Record<string, unknown>,
  notifications: {} as Record<string, unknown>,
  friends: {
    blocked: [] as { id: string; displayName: string; username: string; avatarUrl?: string }[],
    unblock: vi.fn(),
  },
  joinSoundOpen: vi.fn(),
}));

vi.mock("@/components/account/UserSettings", () => ({
  UserSettings: (props: unknown) => {
    world.shown = props;
    return null;
  },
}));

vi.mock("@/hooks/useBrowserNotifications", () => ({
  useBrowserNotifications: () => world.notifications,
}));

vi.mock("@/state/hooks", () => ({
  useAccount: () => world.account,
  useEmoji: () => ({ emoji: [] }),
  useFriends: () => world.friends,
  useKeybinds: () => ({}),
  useLanguage: () => ({
    locale: "pl",
    chatTranslationEnabled: false,
    chatAutoTranslateEnabled: false,
    chatTranslationTargetLanguage: "en",
    update: vi.fn(),
    t: (key: string) => key,
  }),
  usePorts: () => world.ports,
  useSession: () => ({ logout: world.logout }),
  useTheme: () => ({
    theme: {},
    resolved: "dark",
    update: vi.fn(),
    reset: vi.fn(),
  }),
  useUi: () => ({ modal: world.modal, closeModal: world.closeModal }),
}));

vi.mock("./useAccountSecurity", () => ({
  useAccountSecurity: () => ({ sections: { marker: "security" }, dialog: { step: null } }),
}));
vi.mock("@/components/account/panes/SecurityStepDialog", () => ({ SecurityStepDialog: () => null }));
vi.mock("./useMicTest", () => ({ useMicTest: () => ({ marker: "mic" }) }));
vi.mock("./useOutputTest", () => ({ useOutputTest: () => ({ marker: "output" }) }));
vi.mock("./useCameraTest", () => ({ useCameraTest: () => ({ marker: "camera" }) }));
vi.mock("./useJoinSound", () => ({
  useJoinSound: (open: boolean) => {
    world.joinSoundOpen(open);
    return { marker: "join-sound" };
  },
}));

function dialog(): UserSettingsProps {
  if (world.shown === null) throw new Error("The dialog was not rendered");
  return world.shown as UserSettingsProps;
}

/** A voice settings store that behaves like the real one: update merges, reset restores. */
function voiceStore() {
  let settings: VoiceSettings = { ...DEFAULT_SETTINGS };
  const listeners = new Set<() => void>();
  const publish = (next: VoiceSettings) => {
    settings = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => settings,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: vi.fn((patch: Partial<VoiceSettings>) => publish({ ...settings, ...patch })),
    reset: vi.fn(() => publish({ ...DEFAULT_SETTINGS })),
  };
}

function setAccount(vadSensitivity: number) {
  world.account = {
    account: { id: "u1", displayName: "Maja" },
    preferences: { vadSensitivity },
    supported: { profile: true, uploads: true, password: true, preferences: true },
    update: vi.fn(),
    setPreferences: vi.fn(async () => undefined),
    changePassword: vi.fn(),
    setImage: vi.fn(),
    removeImage: vi.fn(),
  };
}

function setPreferences() {
  return world.account["setPreferences"] as ReturnType<typeof vi.fn>;
}

function setDesktop(desktop?: DesktopPort) {
  world.ports = { ...world.ports, desktop };
}

beforeEach(() => {
  world.shown = null;
  world.friends = { blocked: [], unblock: vi.fn() };
  world.modal = "account";
  world.closeModal = vi.fn();
  world.logout = vi.fn(async () => undefined);
  world.joinSoundOpen = vi.fn();
  world.notifications = {
    supported: true,
    permission: "default",
    pending: false,
    error: false,
    request: vi.fn(async () => true),
  };
  setAccount(50);
  world.ports = { voiceSettings: voiceStore() };
});

describe("UserSettingsContainer", () => {
  it.each([
    [null, false, "konto"],
    ["invite", false, "konto"],
    ["account", true, "konto"],
    ["profile", true, "konto"],
    ["voice", true, "glos"],
  ])("with the %s modal requested: open %s on pane %s", (modal, open, pane) => {
    world.modal = modal;

    render(<UserSettingsContainer />);

    expect(dialog().open).toBe(open);
    expect(dialog().initialPane).toBe(pane);
    expect(world.joinSoundOpen).toHaveBeenLastCalledWith(open);
  });

  it("closes through the ui and signs out only after closing", async () => {
    render(<UserSettingsContainer />);

    dialog().onClose();
    await act(async () => dialog().onLogout());

    expect(world.closeModal).toHaveBeenCalledTimes(2);
    expect(world.logout).toHaveBeenCalledOnce();
    expect(world.closeModal.mock.invocationCallOrder[1]).toBeLessThan(
      world.logout.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("lists the blocked people from the friends store and unblocks through it", () => {
    world.friends.blocked = [
      { id: "u-ola", displayName: "Ola", username: "ola", avatarUrl: "/assets/ola" },
      { id: "u-nils", displayName: "Nils", username: "nils" },
    ];
    render(<UserSettingsContainer />);

    expect(dialog().blocked?.people).toEqual([
      { id: "u-ola", displayName: "Ola", username: "ola", avatarUrl: "/assets/ola" },
      { id: "u-nils", displayName: "Nils", username: "nils" },
    ]);
    dialog().blocked?.onUnblock("u-nils");
    expect(world.friends.unblock).toHaveBeenCalledExactlyOnceWith("u-nils");
  });

  it("hands the appearance pane the account's reduced motion and stores a change", () => {
    world.account = { ...world.account, preferences: { vadSensitivity: 50, reducedMotion: true } };
    render(<UserSettingsContainer />);

    expect(dialog().appearance.motion?.reducedMotion).toBe(true);
    dialog().appearance.motion?.onChange(false);
    expect(setPreferences()).toHaveBeenCalledWith({ reducedMotion: false });
  });

  it("hands the dialog the test hooks for the voice pane", () => {
    render(<UserSettingsContainer />);

    expect(dialog().voice).toMatchObject({
      mic: { marker: "mic" },
      output: { marker: "output" },
      camera: { marker: "camera" },
    });
    expect(dialog().accountPane.joinSound).toMatchObject({ marker: "join-sound" });
  });

  describe("sensitivity", () => {
    it("applies the stored value to the live voice settings, and follows a change", () => {
      const { rerender } = render(<UserSettingsContainer />);
      const voice = world.ports["voiceSettings"] as ReturnType<typeof voiceStore>;
      expect(voice.getSnapshot().vadSensitivity).toBe(50);

      setAccount(80);
      rerender(<UserSettingsContainer />);

      expect(voice.getSnapshot().vadSensitivity).toBe(80);
    });

    it("stores a committed value on the account once", async () => {
      render(<UserSettingsContainer />);

      await act(async () => dialog().voice.onVadCommit(70));
      await act(async () => dialog().voice.onVadCommit(70));

      expect(setPreferences()).toHaveBeenCalledTimes(1);
      expect(setPreferences()).toHaveBeenCalledWith({ vadSensitivity: 70 });
    });

    it("sends nothing for a value the account already holds", async () => {
      render(<UserSettingsContainer />);

      await act(async () => dialog().voice.onVadCommit(50));

      expect(setPreferences()).not.toHaveBeenCalled();
    });

    it("puts the live value back when the account refuses the new one", async () => {
      render(<UserSettingsContainer />);
      const voice = world.ports["voiceSettings"] as ReturnType<typeof voiceStore>;
      setPreferences().mockRejectedValueOnce(new Error("offline"));
      act(() => voice.update({ vadSensitivity: 70 }));

      await act(async () => dialog().voice.onVadCommit(70));

      expect(voice.getSnapshot().vadSensitivity).toBe(50);
      // The refused value is no longer considered stored, so it can be retried.
      await act(async () => dialog().voice.onVadCommit(70));
      expect(setPreferences()).toHaveBeenCalledTimes(2);
    });

    it("restores the defaults and stores the default sensitivity", async () => {
      render(<UserSettingsContainer />);
      const voice = world.ports["voiceSettings"] as ReturnType<typeof voiceStore>;
      act(() => voice.update({ vadSensitivity: 90 }));

      await act(async () => dialog().voice.onReset());

      expect(voice.reset).toHaveBeenCalledOnce();
      expect(setPreferences()).toHaveBeenCalledWith({
        vadSensitivity: DEFAULT_SETTINGS.vadSensitivity,
      });
    });
  });

  describe("system notifications", () => {
    function change(enabled: boolean) {
      const { onChange } = dialog().systemNotifications ?? {};
      return act(async () => onChange?.(enabled));
    }

    it("stores the switch only once the browser grants permission", async () => {
      render(<UserSettingsContainer />);

      await change(true);

      expect(world.notifications["request"]).toHaveBeenCalledOnce();
      expect(setPreferences()).toHaveBeenCalledWith({ desktopNotifications: true });
    });

    it("leaves the preference alone when permission is refused", async () => {
      world.notifications["request"] = vi.fn(async () => false);
      render(<UserSettingsContainer />);

      await change(true);

      expect(setPreferences()).not.toHaveBeenCalled();
    });

    it("switches off without asking the browser", async () => {
      render(<UserSettingsContainer />);

      await change(false);

      expect(world.notifications["request"]).not.toHaveBeenCalled();
      expect(setPreferences()).toHaveBeenCalledWith({ desktopNotifications: false });
    });
  });

  describe("startup", () => {
    it("is not offered outside the desktop client", () => {
      render(<UserSettingsContainer />);

      expect(dialog().startup).toBeUndefined();
    });

    it("is offered with the system's setting inside it", async () => {
      setDesktop({
        getAutostart: vi.fn(async () => ({ available: true, enabled: true })),
        setAutostart: vi.fn(async (enabled) => ({ available: true, enabled })),
      });

      await act(async () => {
        render(<UserSettingsContainer />);
      });

      expect(dialog().startup).toMatchObject({ enabled: true, pending: false });
    });
  });
});
