import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_KEYBINDINGS } from "@/lib/keybinds";
import type {
  Account,
  CameraTest,
  JoinSoundPicker,
  MicTest,
  OutputTest,
  UserPreferences,
  VoiceSettings,
} from "@/ports";

import { revealSettingsNavItem } from "./settingsNav";
import { UserSettings, type UserSettingsProps } from "./UserSettings";

const account: Account = {
  id: "u-maja-9",
  username: "maja",
  displayName: "Maja",
  email: "maja@example.com",
  createdAt: new Date(0).toISOString(),
  customStatus: "🎧 na słuchawkach",
  bio: "Trzymam ten serwer w kupie.",
  pronouns: "ona/jej",
};

/** A literal rather than `DEFAULT_SETTINGS`: this file is under the same rule
 *  as the components it tests and may only reach `@/ports`. */
const voiceSettings: VoiceSettings = {
  version: 1,
  inputDeviceId: null,
  outputDeviceId: null,
  outputVolume: 100,
  soundboardVolume: 100,
  playbackProfile: "studio",
  playbackTuning: {
    warmthDb: 3.5,
    mudDb: -4.5,
    presenceDb: 5,
    airDb: 3,
    compression: 65,
  },
  videoDeviceId: null,
  cameraQuality: "balanced",
  opusProfile: "premium",
  screenShareQuality: "balanced",
  noiseSuppression: "browser",
  echoCancellation: true,
  autoGainControl: true,
  vadSensitivity: 60,
  inputGainDb: 0,
  inputGate: true,
};

/** A microphone that is present and idle; the tests that care override it. */
const mic: MicTest = {
  devices: [{ deviceId: "mic-1", label: "Blue Yeti" }],
  labelsKnown: true,
  running: false,
  starting: false,
  level: 0,
  peak: 0,
  speaking: false,
  error: null,
  activeNoiseSuppression: null,
  gateActive: null,
  autoGain: null,
  activeDeviceLabel: null,
  start: () => undefined,
  stop: () => undefined,
};

const output: OutputTest = {
  devices: [{ deviceId: "speaker-1", label: "Słuchawki USB" }],
  labelsKnown: true,
  deviceSelectionSupported: true,
  playing: false,
  error: null,
  start: () => undefined,
  stop: () => undefined,
};

const camera: CameraTest = {
  devices: [{ deviceId: "camera-1", label: "Kamera HD" }],
  labelsKnown: true,
  running: false,
  starting: false,
  stream: null,
  error: null,
  start: () => undefined,
  stop: () => undefined,
};

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
  allowFriendRequests: true,
  showPresence: true,
  developerMode: false,
  reducedMotion: false,
  mutedChannelIds: [],
  vadSensitivity: 60,
  joinSoundId: null,
};

const joinSound: JoinSoundPicker = {
  servers: [
    {
      serverId: "server-1",
      serverName: "Stellarr",
      sounds: [
        {
          id: "sound-1",
          name: "Fanfara",
          glyph: "🎺",
          url: "/assets/att-1",
          durationSeconds: 8,
          trimStartSeconds: 0,
          trimEndSeconds: 5,
        },
        {
          id: "sound-2",
          name: "Gong",
          glyph: "🔔",
          url: "/assets/att-2",
          durationSeconds: 3,
          trimStartSeconds: 0,
          trimEndSeconds: 3,
        },
      ],
    },
  ],
  loading: false,
  failed: false,
  selectedId: null,
  selectionAvailable: true,
  maxSeconds: 5,
  select: () => undefined,
  preview: () => undefined,
  reload: () => undefined,
};

function setup(overrides: Partial<UserSettingsProps> = {}) {
  const props: UserSettingsProps = {
    open: true,
    onClose: vi.fn(),
    account,
    accountPane: {
      onSave: vi.fn(),
      onPickImage: vi.fn(),
      onRemoveImage: vi.fn(),
    },
    security: {
      emailSupported: true,
      onChangeEmail: vi.fn(),
      onChangePassword: vi.fn(async () => "changed" as const),
    },
    preferences: { preferences, onChange: vi.fn() },
    sounds: {
      arrivalsAudible: true,
      onArrivalsAudibleChange: vi.fn(),
      soundboardVolume: 80,
      onSoundboardVolumeChange: vi.fn(),
    },
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
    voice: {
      settings: voiceSettings,
      onChange: vi.fn(),
      onVadCommit: vi.fn(),
      onReset: vi.fn(),
      mic,
      output,
      camera,
    },
    onLogout: vi.fn(),
    ...overrides,
  };

  render(<UserSettings {...props} />);
  return props;
}

describe("UserSettings", () => {
  it("reveals a selected mobile tab before the fixed logout action", () => {
    const nav = document.createElement("nav");
    const selected = document.createElement("button");
    Object.defineProperty(nav, "scrollLeft", { value: 802, writable: true });
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({
      left: 44,
      right: 586,
    } as DOMRect);
    vi.spyOn(selected, "getBoundingClientRect").mockReturnValue({
      left: 502,
      right: 646,
    } as DOMRect);
    const scrollTo = vi.fn();
    Object.defineProperty(nav, "scrollTo", { value: scrollTo });

    revealSettingsNavItem(nav, selected);

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: 862,
      behavior: "auto",
    });
  });

  it("opens on the profile and names itself after the person", () => {
    setup();

    expect(screen.getByRole("dialog", { name: "Maja" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Profil" }),
    ).toBeInTheDocument();
  });

  it("picks an arrival sound under sounds and auditions it", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const preview = vi.fn();
    setup({
      initialPane: "dzwieki",
      sounds: {
        arrivalsAudible: true,
        onArrivalsAudibleChange: vi.fn(),
        soundboardVolume: 80,
        onSoundboardVolumeChange: vi.fn(),
        // Already announced by the first sound: the audition is only offered
        // for a choice that stands, so the pane has to be given one.
        joinSound: { ...joinSound, selectedId: "sound-1", select, preview },
      },
    });

    const picker = screen.getByLabelText(/Twój dźwięk/);
    expect(screen.getByRole("group", { name: "Stellarr" })).toBeInTheDocument();

    await user.selectOptions(picker, "sound-2");
    expect(select).toHaveBeenCalledWith("sound-2");

    await user.click(screen.getByRole("button", { name: /Posłuchaj/ }));
    expect(preview).toHaveBeenCalled();

    // Back to the shared chime is `null`, the same erasure the account stores.
    await user.selectOptions(picker, "");
    expect(select).toHaveBeenCalledWith(null);
  });

  it("keeps showing an arrival sound whose server was left", () => {
    setup({
      initialPane: "dzwieki",
      sounds: {
        arrivalsAudible: true,
        onArrivalsAudibleChange: vi.fn(),
        soundboardVolume: 80,
        onSoundboardVolumeChange: vi.fn(),
        joinSound: { ...joinSound, servers: [], selectedId: "sound-gone", selectionAvailable: false },
      },
    });

    expect(screen.getByLabelText(/Twój dźwięk/)).toHaveValue("sound-gone");
    expect(screen.getByText(/serwera, na którym już Cię nie ma/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Posłuchaj/ })).toBeDisabled();
  });

  it("saves the whole profile at once, and only once something changed", async () => {
    const user = userEvent.setup();
    const props = setup();

    // Nothing to save yet, so there is no save bar.
    expect(screen.queryByRole("button", { name: "Zapisz zmiany" })).toBeNull();

    await user.type(screen.getByLabelText(/Nazwa wyświetlana/), "!");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    // A save carries the whole profile, so an untouched field keeps its value.
    expect(props.accountPane.onSave).toHaveBeenCalledWith({
      displayName: "Maja!",
      pronouns: "ona/jej",
      bio: "Trzymam ten serwer w kupie.",
    });
  });

  it("formats and previews the bio inside account settings", async () => {
    const user = userEvent.setup();
    setup();

    const field = screen.getByRole("textbox", {
      name: /O mnie/,
    }) as HTMLTextAreaElement;
    field.setSelectionRange(0, 7);
    await user.click(screen.getByRole("button", { name: "Pogrubienie" }));

    expect(field).toHaveValue("**Trzymam** ten serwer w kupie.");

    await user.click(screen.getByRole("button", { name: "Pokaż podgląd" }));

    const formatted = screen.getAllByText("Trzymam");
    expect(formatted).toHaveLength(2);
    expect(formatted.every((node) => node.tagName === "STRONG")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Wróć do edycji" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the full picker and inserts a custom server emoji", async () => {
    const user = userEvent.setup();
    setup({
      accountPane: {
        customEmoji: [
          {
            id: "emoji-party",
            shortcode: ":party:",
            glyph: "/emoji/party.webp",
          },
        ],
        onSave: vi.fn(),
        onPickImage: vi.fn(),
        onRemoveImage: vi.fn(),
      },
    });

    const field = screen.getByRole("textbox", {
      name: /O mnie/,
    }) as HTMLTextAreaElement;
    field.setSelectionRange(field.value.length, field.value.length);
    await user.click(screen.getByRole("button", { name: "Dodaj emoji" }));

    expect(screen.getByRole("textbox", { name: "Szukaj emoji" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: ":party:" }));

    expect(field).toHaveValue("Trzymam ten serwer w kupie.:party:");
    expect(screen.getByRole("img", { name: ":party:" })).toHaveAttribute(
      "src",
      "/emoji/party.webp",
    );
  });

  it("changes the pictures by clicking them", async () => {
    const user = userEvent.setup();
    setup();

    // Both live on the account pane now, and both are real buttons rather than
    // a "Zmień" beside a preview that cannot itself be clicked.
    const banner = screen.getByRole("button", { name: /Dodaj tło/ });
    const avatar = screen.getByRole("button", { name: /Dodaj awatar/ });

    // Nothing to remove until there is a picture.
    expect(screen.queryByRole("button", { name: "Usuń awatar" })).toBeNull();

    await user.click(banner);
    await user.click(avatar);
  });

  it("accepts the same avatar again without reopening settings", async () => {
    const user = userEvent.setup();
    const props = setup();
    const avatarInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="image/png"]',
    );
    expect(avatarInput).not.toBeNull();
    const avatar = new File(["avatar"], "avatar.png", { type: "image/png" });

    await user.upload(avatarInput!, avatar);
    await user.upload(avatarInput!, avatar);

    expect(props.accountPane.onPickImage).toHaveBeenNthCalledWith(
      1,
      "avatar",
      avatar,
    );
    expect(props.accountPane.onPickImage).toHaveBeenNthCalledWith(
      2,
      "avatar",
      avatar,
    );
  });

  it("will not change a password until both new fields agree", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(
      screen.getByRole("button", { name: "Logowanie i bezpieczeństwo" }),
    );
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    await user.type(screen.getByLabelText(/Obecne hasło/), "staraaaa1");
    await user.type(screen.getByLabelText(/^Nowe hasło/), "nowehaslo1");
    await user.type(screen.getByLabelText(/Powtórz nowe hasło/), "nowehaslo2");

    const change = screen.getByRole("button", { name: "Zmień hasło" });
    expect(change).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Hasła się nie zgadzają",
    );
    expect(props.security.onChangePassword).not.toHaveBeenCalled();
  });

  it("shows the current e-mail and changes it independently from the profile", async () => {
    const user = userEvent.setup();
    const props = setup();

    expect(screen.queryByText("maja@example.com")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Logowanie i bezpieczeństwo" }),
    );

    expect(screen.getByText("maja@example.com")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    const field = screen.getByRole("textbox", { name: "Nowy adres e-mail" });
    await user.clear(field);
    await user.type(field, "nowy@example.com");
    await user.type(screen.getByLabelText("Obecne hasło"), "haslo1234");
    await user.click(screen.getByRole("button", { name: "Wyślij link" }));

    expect(props.security.onChangeEmail).toHaveBeenCalledExactlyOnceWith(
      "nowy@example.com",
      "haslo1234",
    );
    expect(props.accountPane.onSave).not.toHaveBeenCalled();
  });

  it("switches panes from the nav", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));

    expect(
      screen.getByRole("heading", { level: 2, name: /Skróty klawiszowe/ }),
    ).toBeInTheDocument();
  });

  it("starts recording a replacement for a voice shortcut", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));
    const mute = screen.getByRole("button", {
      name: "Zmień skrót: Wycisz lub włącz mikrofon",
    });

    expect(mute).toHaveTextContent("CtrlShiftM");
    await user.click(mute);

    expect(props.keybinds.beginRecording).toHaveBeenCalledExactlyOnceWith(
      "toggleMute",
    );
    expect(screen.getByText("Nieprzypisany")).toBeInTheDocument();
  });

  it("explains a conflict while recording a shortcut", async () => {
    const user = userEvent.setup();
    setup({
      keybinds: {
        bindings: { ...DEFAULT_KEYBINDINGS },
        recording: "toggleMute",
        recordingError: { kind: "conflict", action: "toggleDeafen" },
        beginRecording: vi.fn(),
        cancelRecording: vi.fn(),
        clearBinding: vi.fn(),
        resetBindings: vi.fn(),
      },
    });

    await user.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ta kombinacja jest już przypisana do: Wycisz lub włącz odsłuch.",
    );
  });

  it("clears one shortcut and can restore changed defaults", async () => {
    const user = userEvent.setup();
    const clearBinding = vi.fn();
    const resetBindings = vi.fn();
    setup({
      keybinds: {
        bindings: { ...DEFAULT_KEYBINDINGS, disconnect: null },
        recording: null,
        recordingError: null,
        beginRecording: vi.fn(),
        cancelRecording: vi.fn(),
        clearBinding,
        resetBindings,
      },
    });

    await user.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));
    await user.click(screen.getByRole("button", {
      name: "Wyczyść skrót: Wycisz lub włącz mikrofon",
    }));
    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));

    expect(clearBinding).toHaveBeenCalledExactlyOnceWith("toggleMute");
    expect(resetBindings).toHaveBeenCalledOnce();
  });

  it("exposes only notification behavior delivered by the client", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    setup({
      preferences: { preferences, onChange },
    });

    await user.click(screen.getByRole("button", { name: /Powiadomienia/ }));
    expect(screen.queryByRole("switch", { name: "Powiadomienia push" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Powiadomienia e-mail" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Dźwięk: Nils oznacza Cię" }));

    expect(onChange).toHaveBeenCalledWith({ messageSound: false });
  });

  it("keeps the sounds of a call on their own pane, away from the profile", async () => {
    const user = userEvent.setup();
    const props = setup({
      accountPane: { onSave: vi.fn(), onPickImage: vi.fn(), onRemoveImage: vi.fn() },
      sounds: {
        joinSound,
        arrivalsAudible: true,
        onArrivalsAudibleChange: vi.fn(),
        soundboardVolume: 80,
        onSoundboardVolumeChange: vi.fn(),
      },
    });

    expect(screen.queryByLabelText(/Twój dźwięk/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Dźwięki" }));

    expect(screen.getByRole("heading", { level: 2, name: "Dźwięki" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Twój dźwięk/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Dźwięk wejścia i wyjścia" }));
    expect(props.sounds.onArrivalsAudibleChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("offers native system startup only when the desktop supplies it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    setup({
      startup: {
        enabled: false,
        pending: false,
        error: false,
        onChange,
      },
    });

    await user.click(screen.getByRole("button", { name: /Zaawansowane/ }));
    await user.click(
      screen.getByRole("switch", {
        name: "Uruchamiaj Stellarr wraz z systemem",
      }),
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("picks a microphone, and offers the system default as its own choice", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));
    const select = screen.getByLabelText("Mikrofon");

    await user.selectOptions(select, "mic-1");
    expect(props.voice.onChange).toHaveBeenCalledWith({
      inputDeviceId: "mic-1",
    });

    // Back to the default is `null`, not the empty string: an unplugged device
    // must fall back to whatever the system picks, not to a dead id.
    await user.selectOptions(select, "");
    expect(props.voice.onChange).toHaveBeenCalledWith({ inputDeviceId: null });
  });

  it("applies VAD immediately and persists it when the adjustment ends", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));
    const sensitivity = screen.getByLabelText(/Czułość wykrywania mowy/);
    fireEvent.change(sensitivity, { target: { value: "75" } });
    fireEvent.pointerUp(sensitivity);

    expect(props.voice.onChange).toHaveBeenCalledWith({ vadSensitivity: 75 });
    expect(props.voice.onVadCommit).toHaveBeenCalledWith(75);
  });

  it("routes playback, changes call volume and runs the speaker test", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const props = setup({
      voice: {
        settings: voiceSettings,
        onChange: vi.fn(),
        onVadCommit: vi.fn(),
        onReset: vi.fn(),
        mic,
        output: { ...output, start },
        camera,
      },
    });

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));
    await user.selectOptions(
      screen.getByLabelText("Urządzenie wyjściowe"),
      "speaker-1",
    );
    fireEvent.change(screen.getByLabelText("Głośność odtwarzania"), {
      target: { value: "55" },
    });
    await user.click(screen.getByRole("button", { name: "Odtwórz dźwięk" }));

    expect(props.voice.onChange).toHaveBeenCalledWith({
      outputDeviceId: "speaker-1",
    });
    expect(props.voice.onChange).toHaveBeenCalledWith({ outputVolume: 55 });
    expect(start).toHaveBeenCalledOnce();
  });

  it("offers receiver EQ controls and turns an adjustment into a custom curve", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));
    await user.click(screen.getByRole("radio", { name: /^Wyłączone/ }));
    expect(props.voice.onChange).toHaveBeenCalledWith({
      playbackProfile: "off",
      playbackTuning: {
        warmthDb: 0,
        mudDb: 0,
        presenceDb: 0,
        airDb: 0,
        compression: 0,
      },
    });

    await user.click(screen.getByRole("radio", { name: /Broadcast/ }));

    expect(props.voice.onChange).toHaveBeenCalledWith({
      playbackProfile: "broadcast",
      playbackTuning: {
        warmthDb: 6,
        mudDb: -6,
        presenceDb: 4,
        airDb: 2,
        compression: 90,
      },
    });

    // A preset is a finished answer: the sliders behind it are not on screen
    // to be nudged, because nudging one is no longer that preset.
    expect(screen.queryByLabelText(/^Ciepło/)).not.toBeInTheDocument();
  });

  it("opens the EQ on the last rung of the row, and nowhere else", async () => {
    const user = userEvent.setup();
    const props = setup({
      voice: {
        settings: { ...voiceSettings, playbackProfile: "custom" },
        onChange: vi.fn(),
        onVadCommit: vi.fn(),
        onReset: vi.fn(),
        mic,
        output,
        camera,
      },
    });

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));
    // "Własne" keeps whatever the preset before it had left behind, so the
    // sliders open where the sound already was.
    expect(screen.getByLabelText(/^Ciepło/)).toHaveValue("3.5");

    fireEvent.change(screen.getByLabelText(/^Ciepło/), {
      target: { value: "-1.5" },
    });
    expect(props.voice.onChange).toHaveBeenCalledWith({
      playbackProfile: "custom",
      playbackTuning: {
        ...voiceSettings.playbackTuning,
        warmthDb: -1.5,
      },
    });
  });

  it("selects a camera and starts a local-only preview", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const props = setup({
      voice: {
        settings: voiceSettings,
        onChange: vi.fn(),
        onVadCommit: vi.fn(),
        onReset: vi.fn(),
        mic,
        output,
        camera: { ...camera, start },
      },
    });

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));
    await user.selectOptions(screen.getByLabelText("Kamera"), "camera-1");
    await user.click(screen.getByRole("button", { name: "Sprawdź kamerę" }));

    expect(props.voice.onChange).toHaveBeenCalledWith({
      videoDeviceId: "camera-1",
    });
    expect(start).toHaveBeenCalledOnce();
  });

  it("reads back what the detector decided while the test runs", async () => {
    const user = userEvent.setup();
    setup({
      voice: {
        settings: voiceSettings,
        onChange: vi.fn(),
        onVadCommit: vi.fn(),
        onReset: vi.fn(),
        mic: { ...mic, running: true, speaking: true, level: 0.75, peak: 0.9 },
        output,
        camera,
      },
    });

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));

    expect(
      screen.getByRole("meter", { name: "Poziom mikrofonu" }),
    ).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByText(/To trafiłoby do rozmowy/)).toBeInTheDocument();
  });

  it("does not claim a noise suppressor that failed to start", async () => {
    const user = userEvent.setup();
    setup({
      voice: {
        settings: { ...voiceSettings, noiseSuppression: "rnnoise" },
        onChange: vi.fn(),
        onVadCommit: vi.fn(),
        onReset: vi.fn(),
        // Asked for RNNoise; the pipeline fell back to the browser's own.
        mic: { ...mic, running: true, activeNoiseSuppression: "browser" },
        output,
        camera,
      },
    });

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));

    expect(
      screen.getByText(
        /Wybrano „RNNoise”, ale mikrofon czyści teraz redukcja przeglądarki/,
      ),
    ).toBeInTheDocument();
  });

  it("stays quiet when the suppressor is the one that was asked for", async () => {
    const user = userEvent.setup();
    setup({
      voice: {
        settings: { ...voiceSettings, noiseSuppression: "browser" },
        onChange: vi.fn(),
        onVadCommit: vi.fn(),
        onReset: vi.fn(),
        mic: { ...mic, running: true, activeNoiseSuppression: "browser" },
        output,
        camera,
      },
    });

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));

    expect(screen.queryByText(/mikrofon czyści teraz/)).toBeNull();
  });

  it("asks once before putting the voice settings back to defaults", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /Głos i wideo/ }));
    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));

    expect(props.voice.onReset).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Tak, przywróć" }));
    expect(props.voice.onReset).toHaveBeenCalledOnce();
  });

  it("logs out from the nav", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /Wyloguj się/ }));

    expect(props.onLogout).toHaveBeenCalledOnce();
  });
});
