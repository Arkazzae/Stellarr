import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  INPUT_GAIN_MAX_DB,
  INPUT_GAIN_MIN_DB,
  STORAGE_KEY,
  SETTINGS_VERSION,
  VoiceSettingsStore,
  clampSensitivity,
  needsRecapture,
  parseVoiceSettings,
  storageKeyForUser,
  wantsCaptureGraph,
  type VoiceSettings,
} from "./settings";

/** A Storage stand-in that can also be told to misbehave. */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
    clear: vi.fn(() => map.clear()),
    key: vi.fn(() => null),
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

const VALID: VoiceSettings = {
  version: SETTINGS_VERSION,
  inputDeviceId: "mic-1",
  outputDeviceId: "speaker-1",
  outputVolume: 65,
  soundboardVolume: 72,
  playbackProfile: "broadcast",
  playbackTuning: {
    warmthDb: 6,
    mudDb: -6,
    presenceDb: 4,
    airDb: 2,
    compression: 90,
  },
  videoDeviceId: "camera-1",
  cameraQuality: "sharp",
  opusProfile: "clarity",
  screenShareQuality: "sharp",
  noiseSuppression: "rnnoise",
  echoCancellation: false,
  autoGainControl: false,
  vadSensitivity: 80,
  inputGainDb: 0,
  inputGate: true,
};

describe("parseVoiceSettings", () => {
  it("accepts a well-formed object unchanged", () => {
    expect(parseVoiceSettings(VALID)).toEqual(VALID);
  });

  it("accepts the Premium profile and uses it for a fresh install", () => {
    expect(DEFAULT_SETTINGS.opusProfile).toBe("premium");
    expect(DEFAULT_SETTINGS.noiseSuppression).toBe("rnnoise");
    expect(parseVoiceSettings({ ...VALID, opusProfile: "premium" }).opusProfile).toBe(
      "premium",
    );
  });

  it("accepts the Studio Opus ceiling and playback processing profiles", () => {
    expect(parseVoiceSettings({ ...VALID, opusProfile: "studio" })).toMatchObject({
      opusProfile: "studio",
      playbackProfile: "broadcast",
    });
    expect(
      parseVoiceSettings({ ...VALID, playbackProfile: "unknown" })
        .playbackProfile,
    ).toBe(DEFAULT_SETTINGS.playbackProfile);
    expect(parseVoiceSettings({ ...VALID, playbackProfile: "off" }).playbackProfile).toBe(
      "off",
    );
  });

  it("validates a custom receiver EQ curve field by field", () => {
    expect(
      parseVoiceSettings({
        ...VALID,
        playbackProfile: "custom",
        playbackTuning: {
          warmthDb: 99,
          mudDb: -99,
          presenceDb: 1.26,
          airDb: Number.NaN,
          compression: 48.7,
        },
      }),
    ).toMatchObject({
      playbackProfile: "custom",
      playbackTuning: {
        warmthDb: 12,
        mudDb: -12,
        presenceDb: 1.5,
        airDb: DEFAULT_SETTINGS.playbackTuning.airDb,
        compression: 49,
      },
    });
  });

  it("falls back to defaults for anything that is not an object", () => {
    for (const value of [null, undefined, 42, "nope", [], true]) {
      expect(parseVoiceSettings(value)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("discards a stored object from another version", () => {
    // Half-migrating an audio pipeline is worse than resetting five choices.
    expect(parseVoiceSettings({ ...VALID, version: SETTINGS_VERSION + 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(parseVoiceSettings({ ...VALID, version: "1" })).toEqual(DEFAULT_SETTINGS);
  });

  it("replaces only the corrupt field, not the whole object", () => {
    const parsed = parseVoiceSettings({ ...VALID, opusProfile: "ultra" });
    expect(parsed.opusProfile).toBe(DEFAULT_SETTINGS.opusProfile);
    // Everything else the person chose survives.
    expect(parsed.noiseSuppression).toBe("rnnoise");
    expect(parsed.vadSensitivity).toBe(80);
  });

  it("rejects an unknown noise mode", () => {
    expect(parseVoiceSettings({ ...VALID, noiseSuppression: "magic" })).toMatchObject({
      noiseSuppression: DEFAULT_SETTINGS.noiseSuppression,
    });
  });

  it("defaults a missing or unknown screen-share profile safely", () => {
    expect(
      parseVoiceSettings({ ...VALID, screenShareQuality: "cinema" })
        .screenShareQuality,
    ).toBe(DEFAULT_SETTINGS.screenShareQuality);
    expect(
      parseVoiceSettings({ ...VALID, screenShareQuality: undefined })
        .screenShareQuality,
    ).toBe(
      DEFAULT_SETTINGS.screenShareQuality,
    );
  });

  it("defaults a missing or unknown camera profile safely", () => {
    expect(
      parseVoiceSettings({ ...VALID, cameraQuality: "cinema" }).cameraQuality,
    ).toBe(DEFAULT_SETTINGS.cameraQuality);
    expect(
      parseVoiceSettings({ ...VALID, cameraQuality: undefined }).cameraQuality,
    ).toBe(DEFAULT_SETTINGS.cameraQuality);
  });

  it("treats an empty or non-string device id as 'default'", () => {
    expect(parseVoiceSettings({ ...VALID, inputDeviceId: "" }).inputDeviceId).toBeNull();
    expect(parseVoiceSettings({ ...VALID, inputDeviceId: 7 }).inputDeviceId).toBeNull();
    expect(parseVoiceSettings({ ...VALID, outputDeviceId: "" }).outputDeviceId).toBeNull();
    expect(parseVoiceSettings({ ...VALID, videoDeviceId: 7 }).videoDeviceId).toBeNull();
  });

  it("clamps playback volume and defaults it for older stored settings", () => {
    expect(parseVoiceSettings({ ...VALID, outputVolume: -1 }).outputVolume).toBe(0);
    expect(parseVoiceSettings({ ...VALID, outputVolume: 900 }).outputVolume).toBe(100);
    expect(parseVoiceSettings({ ...VALID, outputVolume: undefined }).outputVolume).toBe(
      DEFAULT_SETTINGS.outputVolume,
    );
  });

  it("clamps soundboard volume and preserves the old effective level", () => {
    expect(
      parseVoiceSettings({ ...VALID, soundboardVolume: -1 }).soundboardVolume,
    ).toBe(0);
    expect(
      parseVoiceSettings({ ...VALID, soundboardVolume: 900 }).soundboardVolume,
    ).toBe(100);
    expect(
      parseVoiceSettings({ ...VALID, soundboardVolume: undefined })
        .soundboardVolume,
    ).toBe(VALID.outputVolume);
  });

  it("clamps sensitivity into range and rounds it", () => {
    expect(parseVoiceSettings({ ...VALID, vadSensitivity: -50 }).vadSensitivity).toBe(0);
    expect(parseVoiceSettings({ ...VALID, vadSensitivity: 900 }).vadSensitivity).toBe(100);
    expect(parseVoiceSettings({ ...VALID, vadSensitivity: 42.6 }).vadSensitivity).toBe(43);
    expect(clampSensitivity(Number.NaN)).toBe(DEFAULT_SETTINGS.vadSensitivity);
    expect(clampSensitivity(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_SETTINGS.vadSensitivity,
    );
  });

  it("keeps booleans strictly boolean", () => {
    const parsed = parseVoiceSettings({ ...VALID, echoCancellation: "yes" });
    expect(parsed.echoCancellation).toBe(DEFAULT_SETTINGS.echoCancellation);
  });
});

describe("input gate", () => {
  it("is on by default and parsed as a boolean", () => {
    expect(DEFAULT_SETTINGS.inputGate).toBe(true);
    expect(parseVoiceSettings({ ...VALID, inputGate: false }).inputGate).toBe(false);
    expect(parseVoiceSettings({ ...VALID, inputGate: "yes" }).inputGate).toBe(true);
  });

  it("accepts every suppressor engine", () => {
    for (const mode of ["gtcrn", "speex", "rnnoise", "browser", "off"] as const) {
      expect(parseVoiceSettings({ ...VALID, noiseSuppression: mode }).noiseSuppression).toBe(mode);
    }
  });

  it("rebuilds the capture when the gate is toggled", () => {
    expect(
      needsRecapture(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, inputGate: false }),
    ).toBe(true);
  });
});

describe("needsRecapture", () => {
  it("is true only for settings that change what the device produces", () => {
    expect(needsRecapture(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(false);
    // Profiles and sensitivity are applied without reopening the microphone.
    expect(
      needsRecapture(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, opusProfile: "clarity" }),
    ).toBe(false);
    expect(
      needsRecapture(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, vadSensitivity: 90 }),
    ).toBe(false);
    expect(
      needsRecapture(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        playbackProfile: "broadcast",
      }),
    ).toBe(false);
    expect(
      needsRecapture(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        screenShareQuality: "sharp",
      }),
    ).toBe(false);
    expect(
      needsRecapture(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        soundboardVolume: 25,
      }),
    ).toBe(false);

    for (const patch of [
      { inputDeviceId: "other" },
      { noiseSuppression: "browser" as const },
      { echoCancellation: false },
      { autoGainControl: false },
    ]) {
      expect(needsRecapture(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, ...patch })).toBe(
        true,
      );
    }
  });
});

describe("VoiceSettingsStore", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("starts from defaults when storage is empty", () => {
    expect(new VoiceSettingsStore(storage).getSnapshot()).toEqual(DEFAULT_SETTINGS);
  });

  it("restores what was written", () => {
    const first = new VoiceSettingsStore(storage);
    first.update({ opusProfile: "clarity", vadSensitivity: 70 });

    const second = new VoiceSettingsStore(storage);
    expect(second.getSnapshot()).toMatchObject({
      opusProfile: "clarity",
      vadSensitivity: 70,
    });
  });

  it("keeps device settings isolated between signed-in users", () => {
    const store = new VoiceSettingsStore(storage);
    store.setOwner("user-a");
    store.update({ inputDeviceId: "mic-a", noiseSuppression: "off" });

    expect(store.setOwner("user-b")).toMatchObject({
      inputDeviceId: null,
      noiseSuppression: "rnnoise",
    });
    store.update({ inputDeviceId: "mic-b", noiseSuppression: "browser" });

    expect(store.setOwner("user-a")).toMatchObject({
      inputDeviceId: "mic-a",
      noiseSuppression: "off",
    });
    expect(store.setOwner("user-b")).toMatchObject({
      inputDeviceId: "mic-b",
      noiseSuppression: "browser",
    });
  });

  it("keeps the snapshot stable when another owner has identical defaults", () => {
    const store = new VoiceSettingsStore(storage);
    const snapshot = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setOwner("new-user");

    expect(store.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it("migrates the old global value once to the active account", () => {
    const legacy = { ...VALID, inputDeviceId: "old-mic" };
    const migratedStorage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify(legacy),
    });
    const store = new VoiceSettingsStore(migratedStorage);

    expect(store.setOwner("owner")).toMatchObject({ inputDeviceId: "old-mic" });
    expect(migratedStorage.getItem(storageKeyForUser("owner"))).not.toBeNull();
    expect(migratedStorage.getItem(STORAGE_KEY)).toBeNull();

    expect(store.setOwner("different-owner")).toMatchObject({
      inputDeviceId: null,
      noiseSuppression: "rnnoise",
    });
  });

  it("does not hand a legacy value to two accounts when migration is quota-locked", () => {
    const locked = memoryStorage({ [STORAGE_KEY]: JSON.stringify(VALID) });
    (locked.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const store = new VoiceSettingsStore(locked);

    expect(store.setOwner("first").inputDeviceId).toBe(VALID.inputDeviceId);
    expect(store.setOwner("second")).toMatchObject({
      inputDeviceId: null,
      noiseSuppression: "rnnoise",
    });
  });

  it("discards a stale legacy value when the active account is already scoped", () => {
    const scoped = { ...VALID, inputDeviceId: "current-mic" };
    const legacy = { ...VALID, inputDeviceId: "someone-elses-mic" };
    const mixedStorage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify(legacy),
      [storageKeyForUser("current")]: JSON.stringify(scoped),
    });
    const store = new VoiceSettingsStore(mixedStorage);

    expect(store.setOwner("current").inputDeviceId).toBe("current-mic");
    expect(mixedStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(store.setOwner("next")).toMatchObject({
      inputDeviceId: null,
      noiseSuppression: "rnnoise",
    });
  });

  it("recovers from unparseable storage rather than throwing", () => {
    const store = new VoiceSettingsStore(memoryStorage({ [STORAGE_KEY]: "{not json" }));
    expect(store.getSnapshot()).toEqual(DEFAULT_SETTINGS);
  });

  it("recovers from storage that throws on read", () => {
    const hostile = {
      getItem: () => {
        throw new DOMException("blocked");
      },
      setItem: () => {},
    } as unknown as Storage;
    expect(new VoiceSettingsStore(hostile).getSnapshot()).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps applying a setting even when the write is refused", () => {
    const full = memoryStorage();
    (full.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const store = new VoiceSettingsStore(full);
    // Private mode must not stop the change taking effect in this session.
    expect(store.update({ opusProfile: "economy" }).opusProfile).toBe("economy");
  });

  it("works with no storage at all", () => {
    const store = new VoiceSettingsStore(null);
    expect(store.update({ vadSensitivity: 10 }).vadSensitivity).toBe(10);
  });

  it("notifies subscribers only when something actually changed", () => {
    const store = new VoiceSettingsStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.update({ opusProfile: "clarity" });
    expect(listener).toHaveBeenCalledTimes(1);

    store.update({ opusProfile: "clarity" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns a stable snapshot between changes, for useSyncExternalStore", () => {
    const store = new VoiceSettingsStore(storage);
    const first = store.getSnapshot();
    store.update({ opusProfile: store.getSnapshot().opusProfile });
    expect(store.getSnapshot()).toBe(first);
  });

  it("validates a patch instead of trusting it", () => {
    const store = new VoiceSettingsStore(storage);
    const next = store.update({
      vadSensitivity: 1000,
      opusProfile: "nonsense" as never,
    });
    expect(next.vadSensitivity).toBe(100);
    expect(next.opusProfile).toBe(DEFAULT_SETTINGS.opusProfile);
  });

  it("resets to defaults", () => {
    const store = new VoiceSettingsStore(storage);
    store.update({ opusProfile: "clarity", noiseSuppression: "off" });
    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
    expect(new VoiceSettingsStore(storage).getSnapshot()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("input gain", () => {
  it("defaults to 0 dB and clamps to the slider's range and step", () => {
    expect(DEFAULT_SETTINGS.inputGainDb).toBe(0);
    expect(parseVoiceSettings({ ...VALID, inputGainDb: 40 }).inputGainDb).toBe(INPUT_GAIN_MAX_DB);
    expect(parseVoiceSettings({ ...VALID, inputGainDb: -40 }).inputGainDb).toBe(INPUT_GAIN_MIN_DB);
    expect(parseVoiceSettings({ ...VALID, inputGainDb: 5.4 }).inputGainDb).toBe(5);
    expect(parseVoiceSettings({ ...VALID, inputGainDb: "loud" }).inputGainDb).toBe(0);
    expect(parseVoiceSettings({ ...VALID, inputGainDb: 7 }).inputGainDb).toBe(7);
  });

  it("is retuned live under a graph, and reopens the device only when it is the sole reason for one", () => {
    // The defaults already carry a graph (RNNoise, gate, leveller): the slider is live.
    expect(wantsCaptureGraph(DEFAULT_SETTINGS)).toBe(true);
    expect(needsRecapture(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, inputGainDb: 6 })).toBe(false);

    const bare: VoiceSettings = {
      ...DEFAULT_SETTINGS,
      noiseSuppression: "off",
      inputGate: false,
      autoGainControl: false,
    };
    expect(wantsCaptureGraph(bare)).toBe(false);
    expect(needsRecapture(bare, { ...bare, inputGainDb: 6 })).toBe(true);
    expect(needsRecapture({ ...bare, inputGainDb: 6 }, { ...bare, inputGainDb: 12 })).toBe(false);
    expect(needsRecapture({ ...bare, inputGainDb: 6 }, bare)).toBe(true);
  });

  it("counts automatic volume as a reason for a graph, since the leveller lives there", () => {
    expect(
      wantsCaptureGraph({
        ...DEFAULT_SETTINGS,
        noiseSuppression: "off",
        inputGate: false,
        autoGainControl: true,
      }),
    ).toBe(true);
  });
});
