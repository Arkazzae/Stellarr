import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_KEYBINDINGS } from "@/lib/keybinds";
import type {
  Account,
  CameraTest,
  MicTest,
  OutputTest,
  UserPreferences,
  VoiceSettings,
} from "@/ports";

import { UserSettings, type UserSettingsProps } from "./UserSettings";

const account: Account = {
  id: "u-maja-9",
  username: "maja",
  displayName: "Maja",
  createdAt: new Date(0).toISOString(),
  customStatus: "",
  bio: "",
  pronouns: "",
};

const preferences: UserPreferences = {
  desktopNotifications: false,
  emailNotifications: false,
  pushNotifications: false,
  mentionsOnly: false,
  messageSound: true,
  joinLeaveSound: true,
  allowDirectMessages: true,
  allowFriendRequests: true,
  showPresence: true,
  developerMode: false,
  reducedMotion: false,
  mutedChannelIds: [],
  vadSensitivity: 60,
  joinSoundId: null,
};

// The voice pane is only mounted when it is the active pane, so its devices
// and settings can stand in as empty shapes here.
const voice = {
  settings: {} as VoiceSettings,
  onChange: vi.fn(),
  onVadCommit: vi.fn(),
  onReset: vi.fn(),
  mic: {} as MicTest,
  output: {} as OutputTest,
  camera: {} as CameraTest,
};

function props(overrides: Partial<UserSettingsProps> = {}): UserSettingsProps {
  return {
    open: true,
    onClose: vi.fn(),
    account,
    accountPane: {
      profileSupported: true,
      uploadsSupported: true,
      onSave: vi.fn(),
      onPickImage: vi.fn(),
      onRemoveImage: vi.fn(),
    },
    security: {
      emailSupported: true,
      passwordSupported: true,
      onChangeEmail: vi.fn(),
      onChangePassword: vi.fn(async () => "changed" as const),
    },
    preferences: { preferences, supported: true, onChange: vi.fn() },
    keybinds: {
      bindings: { ...DEFAULT_KEYBINDINGS },
      recording: null,
      recordingError: null,
      beginRecording: vi.fn(),
      cancelRecording: vi.fn(),
      clearBinding: vi.fn(),
      resetBindings: vi.fn(),
    },
    appearance: {
      supported: true,
      theme: {
        palette: "midnight",
        accent: "#756cf7",
        scheme: "system",
        contrast: "normal",
        size: "md",
        density: "cozy",
      },
      resolvedScheme: "dark",
      onChange: vi.fn(),
      onReset: vi.fn(),
    },
    voice,
    onLogout: vi.fn(),
    ...overrides,
  };
}

function heading() {
  return screen.getByRole("heading", { level: 2 });
}

describe("UserSettings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens on the pane it was asked for", () => {
    render(<UserSettings {...props({ initialPane: "skroty" })} />);

    expect(heading()).toHaveTextContent("Skróty klawiszowe");
    expect(
      screen.getByRole("button", { name: /Skróty klawiszowe/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("button", { name: /Moje konto/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("labels the dialog with the translator it is given", () => {
    render(<UserSettings {...props({ t: (key) => `<${key}>` })} />);

    expect(heading()).toHaveTextContent("<settings.account.title>");
    expect(
      screen.getByRole("button", { name: "<settings.logout>" }),
    ).toBeInTheDocument();
  });

  it("goes back to the requested pane each time it opens", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UserSettings {...props()} />);

    await user.click(screen.getByRole("button", { name: /Powiadomienia/ }));
    expect(heading()).toHaveTextContent("Powiadomienia");

    rerender(<UserSettings {...props({ open: false })} />);
    rerender(<UserSettings {...props({ initialPane: "wyglad" })} />);

    expect(heading()).toHaveTextContent("Motyw");
  });

  it("closes from the corner button and from Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<UserSettings {...props({ onClose })} />);

    await user.click(screen.getByRole("button", { name: "Zamknij ustawienia" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("stops a pending shortcut recording as soon as its pane is left", async () => {
    const user = userEvent.setup();
    const cancelRecording = vi.fn();
    const base = props();
    render(
      <UserSettings
        {...base}
        initialPane="skroty"
        keybinds={{ ...base.keybinds, recording: "toggleMute", cancelRecording }}
      />,
    );
    expect(cancelRecording).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Moje konto/ }));

    expect(cancelRecording).toHaveBeenCalledTimes(1);
  });

  it("stops a pending shortcut recording when the dialog closes on its pane", () => {
    const cancelRecording = vi.fn();
    const base = props();
    const keybinds = { ...base.keybinds, cancelRecording };
    const { rerender } = render(
      <UserSettings {...base} initialPane="skroty" keybinds={keybinds} />,
    );
    expect(cancelRecording).not.toHaveBeenCalled();

    rerender(
      <UserSettings {...base} open={false} initialPane="skroty" keybinds={keybinds} />,
    );

    expect(cancelRecording).toHaveBeenCalledTimes(1);
  });

  it("starts every pane at the top of the scrolling column", async () => {
    const user = userEvent.setup();
    const { container } = render(<UserSettings {...props()} />);
    const column = container.ownerDocument.querySelector<HTMLElement>(".sv-panes")!;
    column.scrollTop = 240;

    await user.click(screen.getByRole("button", { name: /Prywatność/ }));

    expect(column.scrollTop).toBe(0);
  });

  it("brings the selected tab into view once the dialog has a layout", async () => {
    render(<UserSettings {...props({ initialPane: "zaawansowane" })} />);
    const strip = screen.getByRole("navigation", { name: "Sekcje ustawień" });
    const scrollTo = vi.fn();
    Object.defineProperty(strip, "scrollTo", { value: scrollTo });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === strip) return { left: 0, right: 300 } as DOMRect;
        if (this.getAttribute("aria-current") === "page") {
          return { left: 400, right: 520 } as DOMRect;
        }
        return { left: 0, right: 0 } as DOMRect;
      },
    );

    await vi.waitFor(() =>
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
        left: 220,
        behavior: "auto",
      }),
    );
  });
});
