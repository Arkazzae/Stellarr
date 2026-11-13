import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME, type ThemePreference } from "@/design/themes";
import { DEFAULT_KEYBINDINGS, KEYBIND_STORAGE_VERSION, type Keybindings } from "@/lib/keybinds";
import { VoiceSettingsStore } from "@/lib/voice/settings";
import type { ClientSettingsSnapshot } from "@/ports";

import { SAVE_DELAY_MS, useClientSettingsSync } from "./ClientSettingsSync";

const NOTHING_SAVED: ClientSettingsSnapshot = { appearance: null, language: null, keybinds: null, voice: null };

const world = vi.hoisted(() => ({
  userId: "u1",
  theme: {} as Record<string, unknown>,
  updateTheme: vi.fn(),
  language: {} as Record<string, unknown>,
  updateLanguage: vi.fn(),
  chosen: undefined as string | undefined,
  bindings: {} as Record<string, unknown>,
  replaceBindings: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  voice: null as unknown,
}));

vi.mock("@/state/hooks", () => ({
  useAccount: () => ({ account: { id: world.userId } }),
  useTheme: () => ({ theme: world.theme, resolved: "dark", update: world.updateTheme, reset: vi.fn() }),
  useLanguage: () => ({
    ...world.language,
    update: world.updateLanguage,
    chosenLocale: chosenLocale,
  }),
  useKeybinds: () => ({ bindings: world.bindings, replaceBindings: world.replaceBindings }),
  usePorts: () => ports,
}));

// Stable, as the provider's is.
function chosenLocale() {
  return world.chosen;
}

let ports: { account: Record<string, unknown>; voiceSettings: VoiceSettingsStore };

function voice(): VoiceSettingsStore {
  return world.voice as VoiceSettingsStore;
}

function sync() {
  return renderHook(() => useClientSettingsSync());
}

/** Lets the account's answer arrive and be applied. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  world.userId = "u1";
  world.theme = { ...DEFAULT_THEME };
  world.updateTheme = vi.fn((patch: Partial<ThemePreference>) => {
    world.theme = { ...world.theme, ...patch };
  });
  world.language = {
    locale: "pl",
    chatTranslationEnabled: false,
    chatAutoTranslateEnabled: false,
    chatTranslationTargetLanguage: "en",
  };
  world.updateLanguage = vi.fn();
  world.chosen = undefined;
  world.bindings = { ...DEFAULT_KEYBINDINGS };
  world.replaceBindings = vi.fn();
  world.load = vi.fn(async () => NOTHING_SAVED);
  world.save = vi.fn(async () => undefined);
  world.voice = new VoiceSettingsStore(null);
  voice().update({ inputDeviceId: "usb-mic", vadSensitivity: 40 });
  ports = {
    account: { loadClientSettings: world.load, saveClientSettings: world.save },
    voiceSettings: voice(),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useClientSettingsSync", () => {
  it("lays the account's sections over this device's on sign-in", async () => {
    const custom: Keybindings = { ...DEFAULT_KEYBINDINGS, toggleMute: null };
    world.load = vi.fn(async () => ({
      appearance: { palette: "nonsense", size: "lg" },
      language: { locale: "en", chatTranslationEnabled: true, chatTranslationTargetLanguage: "pl" },
      keybinds: { version: KEYBIND_STORAGE_VERSION, bindings: custom },
      voice: { ...voice().getSnapshot(), inputDeviceId: "their-mic", opusProfile: "studio", vadSensitivity: 90 },
    }));
    ports.account["loadClientSettings"] = world.load;

    sync();
    await settle();

    // Normalised on the way in: an unknown palette is the default one.
    expect(world.updateTheme).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_THEME, size: "lg" });
    expect(world.updateLanguage).toHaveBeenCalledExactlyOnceWith({
      locale: "en",
      chatTranslationEnabled: true,
      chatTranslationTargetLanguage: "pl",
    });
    expect(world.replaceBindings).toHaveBeenCalledExactlyOnceWith({ version: KEYBIND_STORAGE_VERSION, bindings: custom });
    // The device and the sensitivity stay this machine's.
    expect(voice().getSnapshot()).toMatchObject({ opusProfile: "studio", inputDeviceId: "usb-mic", vadSensitivity: 40 });
    expect(world.save).not.toHaveBeenCalled();
  });

  it("gives a section no device saved this device's values, without its devices", async () => {
    world.chosen = "pl";

    sync();
    await settle();

    expect(world.save).toHaveBeenCalledWith("appearance", { ...DEFAULT_THEME });
    expect(world.save).toHaveBeenCalledWith("language", {
      locale: "pl",
      chatTranslationEnabled: false,
      chatTranslationTargetLanguage: "en",
    });
    expect(world.save).toHaveBeenCalledWith("keybinds", {
      version: KEYBIND_STORAGE_VERSION,
      bindings: DEFAULT_KEYBINDINGS,
    });
    const sentVoice = world.save.mock.calls.find(([section]) => section === "voice")?.[1] as Record<string, unknown>;
    expect(sentVoice).toMatchObject({ version: 1, opusProfile: voice().getSnapshot().opusProfile });
    for (const local of ["inputDeviceId", "outputDeviceId", "videoDeviceId", "vadSensitivity"]) {
      expect(sentVoice).not.toHaveProperty(local);
    }
  });

  it("leaves the interface language out until the person has chosen one", async () => {
    sync();
    await settle();

    expect(world.save).toHaveBeenCalledWith("language", {
      chatTranslationEnabled: false,
      chatTranslationTargetLanguage: "en",
    });
  });

  it("sends a change once it settles, and not the value it just applied", async () => {
    world.load = vi.fn(async () => ({ ...NOTHING_SAVED, appearance: { ...DEFAULT_THEME, size: "lg" } }));
    ports.account["loadClientSettings"] = world.load;
    const hook = sync();
    await settle();
    world.save.mockClear();

    // The applied value comes back as a change of the device's theme.
    hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(world.save).not.toHaveBeenCalled();

    world.theme = { ...world.theme, accent: "#112233" };
    hook.rerender();
    world.theme = { ...world.theme, accent: "#445566" };
    hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });

    expect(world.save).toHaveBeenCalledExactlyOnceWith("appearance", {
      ...DEFAULT_THEME,
      size: "lg",
      accent: "#445566",
    });
  });

  it("sends a voice change made on this device, with its devices left out", async () => {
    world.load = vi.fn(async () => ({ ...NOTHING_SAVED, voice: { ...voice().getSnapshot() } }));
    ports.account["loadClientSettings"] = world.load;
    const hook = sync();
    await settle();
    world.save.mockClear();

    act(() => {
      voice().update({ outputDeviceId: "speakers" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(world.save).not.toHaveBeenCalled();

    act(() => {
      voice().update({ echoCancellation: false });
    });
    hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(world.save).toHaveBeenCalledExactlyOnceWith(
      "voice",
      expect.objectContaining({ echoCancellation: false }),
    );
  });

  it("sends a change the account never confirmed instead of taking the older value back", async () => {
    world.save = vi.fn(async () => {
      throw new Error("offline");
    });
    ports.account["saveClientSettings"] = world.save;
    world.load = vi.fn(async () => ({ ...NOTHING_SAVED, appearance: { ...DEFAULT_THEME } }));
    ports.account["loadClientSettings"] = world.load;
    const first = sync();
    await settle();
    world.theme = { ...world.theme, density: "compact" };
    first.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    first.unmount();

    // Next sign-in: the account still has the old theme, and the save works.
    world.save = vi.fn(async () => undefined);
    ports.account["saveClientSettings"] = world.save;
    world.updateTheme.mockClear();
    sync();
    await settle();

    expect(world.updateTheme).not.toHaveBeenCalled();
    expect(world.save).toHaveBeenCalledWith("appearance", { ...DEFAULT_THEME, density: "compact" });
    expect(window.localStorage.getItem("stellarr.settings.pending.u1")).toBeNull();
  });

  it("leaves alone a section another version of the client wrote", async () => {
    const before = voice().getSnapshot();
    world.load = vi.fn(async () => ({
      ...NOTHING_SAVED,
      keybinds: { version: 99, bindings: {} },
      voice: { version: 99, opusProfile: "economy" },
    }));
    ports.account["loadClientSettings"] = world.load;

    sync();
    await settle();

    expect(world.replaceBindings).not.toHaveBeenCalled();
    expect(voice().getSnapshot()).toBe(before);
    expect(world.save).not.toHaveBeenCalledWith("keybinds", expect.anything());
    expect(world.save).not.toHaveBeenCalledWith("voice", expect.anything());
  });

  it("sends nothing until the account has answered, and nothing at all when it cannot", async () => {
    world.load = vi.fn(async () => {
      throw new Error("not found");
    });
    ports.account["loadClientSettings"] = world.load;
    const hook = sync();
    await settle();

    world.theme = { ...world.theme, scheme: "light" };
    hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });

    expect(world.save).not.toHaveBeenCalled();
  });

  it("waits for the signed-in account rather than the blank one", async () => {
    world.userId = "";

    sync();
    await settle();

    expect(world.load).not.toHaveBeenCalled();
  });
});
