import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME } from "@/design/themes";
import { DEFAULT_KEYBINDINGS, KEYBIND_STORAGE_VERSION, readStoredKeybindings } from "@/lib/keybinds";
import { DEFAULT_SETTINGS, VoiceSettingsStore } from "@/lib/voice/settings";
import type { ClientSettingsSnapshot } from "@/ports";
import { KeybindProvider } from "@/state/KeybindProvider";
import { LanguageProvider } from "@/state/LanguageProvider";
import { ThemeProvider } from "@/state/ThemeProvider";
import { useTheme } from "@/state/hooks";

import { ClientSettingsSync, SAVE_DELAY_MS } from "./ClientSettingsSync";

/**
 * The sync against the real providers it drives, rather than stand-ins: the
 * theme reaches the document and its storage, the language the page, the
 * shortcuts their storage, and the voice settings their store.
 */

const world = vi.hoisted(() => ({
  ports: null as unknown,
}));

vi.mock("@/state/PortsProvider", () => ({
  usePorts: () => world.ports,
  useRuntime: () => ({}),
}));
vi.mock("@/state/AccountProvider", () => ({
  useAccountContext: () => ({ account: { id: "u1" } }),
}));
vi.mock("@/state/UiProvider", () => ({
  useUiContext: () => ({ leaveCall: vi.fn() }),
}));
vi.mock("@/state/VoiceProvider", () => ({
  useVoiceContext: () => ({
    channelId: null,
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleCamera: vi.fn(),
  }),
}));

const camera = { code: "KeyJ", ctrl: true, alt: true, shift: false, meta: false };

const ACCOUNT: ClientSettingsSnapshot = {
  appearance: { ...DEFAULT_THEME, size: "lg", density: "compact" },
  language: { locale: "pl", chatTranslationEnabled: true, chatTranslationTargetLanguage: "pl" },
  keybinds: { version: KEYBIND_STORAGE_VERSION, bindings: { ...DEFAULT_KEYBINDINGS, toggleCamera: camera } },
  voice: { ...DEFAULT_SETTINGS, echoCancellation: false, inputDeviceId: "their-mic" },
};

/** A control that changes the theme the way the appearance pane does. */
function Densify() {
  const { update } = useTheme();
  return (
    <button type="button" onClick={() => update({ density: "cozy" })}>
      cozy
    </button>
  );
}

let voice: VoiceSettingsStore;
let save: ReturnType<typeof vi.fn>;

function mount() {
  render(
    <LanguageProvider initialLocale="en">
      <ThemeProvider>
        <KeybindProvider>
          <ClientSettingsSync />
          <Densify />
        </KeybindProvider>
      </ThemeProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  voice = new VoiceSettingsStore(null);
  voice.update({ inputDeviceId: "my-mic" });
  save = vi.fn(async () => undefined);
  world.ports = {
    account: { loadClientSettings: vi.fn(async () => ACCOUNT), saveClientSettings: save },
    voiceSettings: voice,
  };
});

describe("ClientSettingsSync with the real providers", () => {
  it("puts the account's settings on the page, in storage and in the voice store", async () => {
    mount();

    await waitFor(() => expect(document.documentElement.lang).toBe("pl"));
    expect(document.documentElement.dataset["size"]).toBe("lg");
    expect(document.documentElement.dataset["density"]).toBe("compact");
    // Stored, so the next load paints the account's theme before React runs.
    expect(JSON.parse(window.localStorage.getItem("stellarr.theme") ?? "{}")).toMatchObject({ size: "lg" });
    expect(readStoredKeybindings().toggleCamera).toEqual(camera);
    expect(voice.getSnapshot()).toMatchObject({ echoCancellation: false, inputDeviceId: "my-mic" });

    // Nothing applied from the account is sent back to it.
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS + 100));
    expect(save).not.toHaveBeenCalled();
  });

  it("sends a change made through a provider once it settles", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(document.documentElement.dataset["density"]).toBe("compact"));

    await user.click(screen.getByRole("button", { name: "cozy" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith("appearance", {
        ...DEFAULT_THEME,
        size: "lg",
        density: "cozy",
      }),
    );
  });
});
