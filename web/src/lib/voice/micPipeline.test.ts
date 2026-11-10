import { describe, expect, it, vi } from "vitest";
import { AUDIO_PROFILES, microphoneConstraints, opusParameters, profileFor } from "./audioProfiles";
import {
  MicCaptureError,
  captureMicrophone,
  hasDeviceLabels,
  restoreBrowserNoise,
  restoreBrowserProcessing,
} from "./micPipeline";
import { DEFAULT_SETTINGS, type VoiceSettings } from "./settings";

function audioTrack(
  options: {
    /** How `applyConstraints` behaves, and what the device reports back. */
    applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
    noiseSuppression?: boolean | undefined;
    echoCancellation?: boolean | "all" | "remote-only" | undefined;
    echoCapabilities?: Array<boolean | "all" | "remote-only">;
  } = {},
): MediaStreamTrack {
  let noiseSuppression = options.noiseSuppression;
  let echoCancellation = options.echoCancellation;
  return {
    kind: "audio",
    enabled: true,
    contentHint: "",
    stop: vi.fn(),
    applyConstraints: vi.fn(async (constraints: MediaTrackConstraints) => {
      if (options.applyConstraints) return options.applyConstraints(constraints);
      if (typeof constraints.noiseSuppression === "boolean") {
        noiseSuppression = constraints.noiseSuppression;
      }
      const echo = constraints.echoCancellation as unknown as
        | boolean
        | { exact?: boolean | "all" | "remote-only" }
        | undefined;
      if (typeof echo === "boolean") echoCancellation = echo;
      else if (echo?.exact !== undefined) echoCancellation = echo.exact;
    }),
    getCapabilities: () => ({
      echoCancellation: options.echoCapabilities ?? [true, false],
    }),
    getConstraints: () => ({
      sampleRate: 48_000,
      echoCancellation:
        typeof echoCancellation === "string"
          ? ({ exact: echoCancellation } as unknown as boolean)
          : echoCancellation === false
            ? false
            : true,
    }),
    getSettings: () => ({ channelCount: 1, noiseSuppression, echoCancellation }),
  } as unknown as MediaStreamTrack;
}

function audioStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: `stream-${Math.random()}`,
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  } as unknown as MediaStream;
}

function settings(patch: Partial<VoiceSettings> = {}): VoiceSettings {
  // The gate and the leveller need AudioWorklet, which jsdom lacks; tests
  // that want them inject `createGate`. Everything else runs the graph
  // exactly as the browser would.
  return { ...DEFAULT_SETTINGS, inputGate: false, autoGainControl: false, ...patch };
}

let latestDestinationTrack: MediaStreamTrack | null = null;

/** The fixed-gain node every graph starts with. */
function gainNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      value: 1,
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
  } as unknown as GainNode & {
    gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
  };
}

/** What `createMediaStreamDestination` hands back: a live track the peers get. */
function destination() {
  const track = audioTrack();
  latestDestinationTrack = track;
  return { connect: vi.fn(), disconnect: vi.fn(), stream: audioStream([track]) };
}

function lastDestinationTrack(): MediaStreamTrack {
  if (!latestDestinationTrack) throw new Error("no destination was created");
  return latestDestinationTrack;
}

function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
}

/** A suppressor that attached: its output node is what the caller wires on. */
function handle(dispose = vi.fn(), kind: "rnnoise" | "gtcrn" | "speex" = "rnnoise") {
  return { kind, output: fakeNode(), dispose };
}

describe("microphoneConstraints", () => {
  it("gives Premium a 128 kbps continuous mono Opus stream with FEC", () => {
    const profile = AUDIO_PROFILES.premium;
    expect(profile).toMatchObject({
      maxBitrate: 128000,
      minBitrate: 64000,
      stereo: false,
      dtx: false,
      ptime: 20,
    });
    expect(opusParameters(profile)).toMatchObject({
      useinbandfec: "1",
      usedtx: "0",
      maxaveragebitrate: "128000",
      stereo: "0",
    });
  });

  it("offers a 256 kbps continuous mono Studio ceiling", () => {
    const profile = AUDIO_PROFILES.studio;
    expect(profile).toMatchObject({
      maxBitrate: 256000,
      minBitrate: 96000,
      stereo: false,
      dtx: false,
    });
    expect(opusParameters(profile).maxaveragebitrate).toBe("256000");
  });

  it("reserves DTX for the explicitly bandwidth-saving profile", () => {
    expect(AUDIO_PROFILES.economy.dtx).toBe(true);
    expect(AUDIO_PROFILES.balanced.dtx).toBe(false);
    expect(AUDIO_PROFILES.clarity.dtx).toBe(false);
    expect(AUDIO_PROFILES.premium.dtx).toBe(false);
    expect(AUDIO_PROFILES.studio.dtx).toBe(false);
  });

  it("passes echo cancellation through and keeps the browser AGC off", () => {
    // Automatic volume is our own leveller in the graph, so the device is
    // opened without the platform's; it is restored only when the graph fails.
    const constraints = microphoneConstraints(
      settings({ echoCancellation: false, autoGainControl: true }),
    );
    expect(constraints.echoCancellation).toBe(false);
    expect(constraints.autoGainControl).toBe(false);
    expect(
      microphoneConstraints(settings({ autoGainControl: false })).autoGainControl,
    ).toBe(false);
  });

  it("turns off the browser suppressor when RNNoise is selected", () => {
    // Two gates in series chew holes in speech, and the browser's would run
    // first — RNNoise would only ever see already-damaged audio.
    expect(microphoneConstraints(settings({ noiseSuppression: "rnnoise" })).noiseSuppression).toBe(
      false,
    );
    expect(microphoneConstraints(settings({ noiseSuppression: "off" })).noiseSuppression).toBe(
      false,
    );
    expect(microphoneConstraints(settings({ noiseSuppression: "browser" })).noiseSuppression).toBe(
      true,
    );
  });

  it("still asks for echo cancellation with RNNoise on", () => {
    // Echo cancellation is not a noise feature; without it, speakers feed back.
    const constraints = microphoneConstraints(
      settings({ noiseSuppression: "rnnoise", echoCancellation: true }),
    );
    expect(constraints.echoCancellation).toBe(true);
  });

  it("requests mono at 48 kHz to match Opus", () => {
    const constraints = microphoneConstraints(settings());
    expect(constraints.channelCount).toBe(1);
    expect(constraints.sampleRate).toBe(48000);
  });

  it("pins an explicitly chosen device and omits the key otherwise", () => {
    expect(microphoneConstraints(settings({ inputDeviceId: "mic-9" })).deviceId).toEqual({
      exact: "mic-9",
    });
    expect(microphoneConstraints(settings()).deviceId).toBeUndefined();
  });
});

describe("captureMicrophone", () => {
  it("recaptures with full voice isolation when the browser advertises it", async () => {
    const ordinary = audioTrack({
      echoCancellation: true,
      echoCapabilities: [true, false, "remote-only", "all"],
    });
    const isolated = audioTrack({ echoCancellation: "all" });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(audioStream([ordinary]))
      .mockResolvedValueOnce(audioStream([isolated]));

    const capture = await captureMicrophone(settings({ echoCancellation: true }), {
      getUserMedia,
    });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({ echoCancellation: { exact: "all" } }),
      video: false,
    });
    expect(capture.rawTrack).toBe(isolated);
    expect(ordinary.stop).toHaveBeenCalledOnce();
  });

  it("keeps ordinary browser AEC when full isolation is unavailable", async () => {
    const track = audioTrack({
      echoCancellation: true,
      echoCapabilities: [true, false],
    });

    const getUserMedia = vi.fn(async () => audioStream([track]));
    await captureMicrophone(settings({ echoCancellation: true }), {
      getUserMedia,
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(track.getSettings().echoCancellation).toBe(true);
  });

  it("uses remote-only isolation when that is the strongest advertised mode", async () => {
    const ordinary = audioTrack({
      echoCancellation: true,
      echoCapabilities: [true, false, "remote-only"],
    });
    const isolated = audioTrack({ echoCancellation: "remote-only" });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(audioStream([ordinary]))
      .mockResolvedValueOnce(audioStream([isolated]));

    const capture = await captureMicrophone(settings({ echoCancellation: true }), {
      getUserMedia,
    });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({
        echoCancellation: { exact: "remote-only" },
      }),
      video: false,
    });
    expect(capture.rawTrack).toBe(isolated);
  });

  it("does not enable isolation when echo cancellation is switched off", async () => {
    const track = audioTrack({
      echoCancellation: false,
      echoCapabilities: [true, false, "all"],
    });

    await captureMicrophone(
      settings({ echoCancellation: false, noiseSuppression: "off" }),
      {
        getUserMedia: async () => audioStream([track]),
      },
    );

    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it("returns the raw track when no processing is requested", async () => {
    const track = audioTrack();
    const capture = await captureMicrophone(settings({ noiseSuppression: "off" }), {
      getUserMedia: async () => audioStream([track]),
    });

    expect(capture.track).toBe(track);
    expect(capture.rawTrack).toBe(track);
    expect(capture.processed).toBe(false);
    expect(track.contentHint).toBe(profileFor(settings()).contentHint);
  });

  it("stops the device when disposed", async () => {
    const track = audioTrack();
    const capture = await captureMicrophone(settings({ noiseSuppression: "off" }), {
      getUserMedia: async () => audioStream([track]),
    });

    capture.dispose();
    expect(track.stop).toHaveBeenCalledTimes(1);

    // Idempotent: a double dispose must not double-stop.
    capture.dispose();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("publishes the processed track when RNNoise attaches", async () => {
    const raw = audioTrack();
    const disposeHandle = vi.fn();
    const closeContext = vi.fn();

    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: () =>
        ({
          state: "running",
          createMediaStreamSource: () => fakeNode(),
          createMediaStreamDestination: destination,
          createGain: gainNode,
          close: closeContext,
        }) as unknown as AudioContext,
      attach: async () => handle(disposeHandle),
    });

    expect(capture.track).toBe(lastDestinationTrack());
    // The raw device track is still what gets muted and stopped.
    expect(capture.rawTrack).toBe(raw);
    expect(capture.processed).toBe(true);

    capture.dispose();
    expect(disposeHandle).toHaveBeenCalledTimes(1);
    expect(raw.stop).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw device when RNNoise cannot start", async () => {
    const raw = audioTrack();
    const closeContext = vi.fn();

    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: () =>
        ({
          state: "running",
          createMediaStreamSource: () => fakeNode(),
          createMediaStreamDestination: destination,
          createGain: gainNode,
          close: closeContext,
        }) as unknown as AudioContext,
      // The WASM failed to load; the call must still happen.
      attach: async () => null,
    });

    expect(capture.track).toBe(raw);
    expect(capture.processed).toBe(false);
    // The unused context is closed rather than left running.
    expect(closeContext).toHaveBeenCalled();
  });

  it("falls back when there is no Web Audio at all", async () => {
    const raw = audioTrack();
    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: () => null,
    });
    expect(capture.processed).toBe(false);
    expect(capture.track).toBe(raw);
  });

  it("distinguishes a blocked microphone from a missing one", async () => {
    await expect(
      captureMicrophone(settings(), {
        getUserMedia: async () => {
          throw new DOMException("no", "NotAllowedError");
        },
      }),
    ).rejects.toMatchObject({ kind: "denied" });

    await expect(
      captureMicrophone(settings(), {
        getUserMedia: async () => {
          throw new DOMException("no", "NotFoundError");
        },
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("reports an over-constrained device as unavailable, not denied", async () => {
    // A remembered device that has since been unplugged.
    await expect(
      captureMicrophone(settings({ inputDeviceId: "gone" }), {
        getUserMedia: async () => {
          throw new DOMException("no", "OverconstrainedError");
        },
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("reports an unsupported browser when there is no getUserMedia", async () => {
    const original = globalThis.navigator;
    vi.stubGlobal("navigator", {});
    try {
      await expect(captureMicrophone(settings())).rejects.toBeInstanceOf(MicCaptureError);
    } finally {
      vi.stubGlobal("navigator", original);
      vi.unstubAllGlobals();
    }
  });

  it("stops a stream that arrived with no audio track", async () => {
    const empty = audioStream([]);
    await expect(
      captureMicrophone(settings(), { getUserMedia: async () => empty }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("hasDeviceLabels", () => {
  it("is false before permission, when every label is blank", () => {
    expect(
      hasDeviceLabels([{ deviceId: "a", label: "" } as MediaDeviceInfo]),
    ).toBe(false);
  });

  it("is true once the browser reveals names", () => {
    expect(
      hasDeviceLabels([{ deviceId: "a", label: "Zestaw słuchawkowy" } as MediaDeviceInfo]),
    ).toBe(true);
  });
});


describe("browser suppression fallback when RNNoise fails", () => {
  // Regression: with RNNoise requested the device is opened with the browser's
  // suppressor OFF. When the attach failed the raw track kept running
  // unsuppressed while the UI claimed browser suppression had taken over.
  function brokenContext(closeSpy = vi.fn()) {
    return () =>
      ({
        state: "running",
        createMediaStreamSource: () => fakeNode(),
          createMediaStreamDestination: destination,
          createGain: gainNode,
        close: closeSpy,
      }) as unknown as AudioContext;
  }

  it("turns the browser suppressor back on and says so", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: brokenContext(),
      attach: async () => null,
    });

    expect(raw.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ noiseSuppression: true }),
    );
    expect(capture.processed).toBe(false);
    expect(capture.noiseSuppression).toBe("browser");
    // Capture still works: a failed fallback must never cost the call.
    expect(capture.track).toBe(raw);
  });

  it("admits when the device refuses, rather than claiming a fallback", async () => {
    const raw = audioTrack({
      applyConstraints: async () => {
        throw new DOMException("cannot", "OverconstrainedError");
      },
    });
    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: brokenContext(),
      attach: async () => null,
    });

    expect(capture.noiseSuppression).toBe("none");
    // The microphone is still live and usable.
    expect(capture.track).toBe(raw);
    expect(raw.stop).not.toHaveBeenCalled();
  });

  it("admits when the constraint is accepted but silently ignored", async () => {
    // Some devices resolve `applyConstraints` and change nothing.
    const raw = audioTrack({
      applyConstraints: async () => {},
      noiseSuppression: false,
    });
    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: brokenContext(),
      attach: async () => null,
    });

    expect(capture.noiseSuppression).toBe("none");
  });

  it("also restores when there is no Web Audio to attach to", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: () => null,
    });

    expect(raw.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ noiseSuppression: true }),
    );
    expect(capture.noiseSuppression).toBe("browser");
  });

  it("does not touch constraints when RNNoise actually attaches", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const capture = await captureMicrophone(settings({ noiseSuppression: "rnnoise" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: brokenContext(),
      attach: async () => handle(),
    });

    expect(raw.applyConstraints).not.toHaveBeenCalled();
    expect(capture.noiseSuppression).toBe("rnnoise");
  });

  it("reports the plain modes truthfully", async () => {
    const browser = await captureMicrophone(settings({ noiseSuppression: "browser" }), {
      getUserMedia: async () => audioStream([audioTrack()]),
    });
    expect(browser.noiseSuppression).toBe("browser");

    const off = await captureMicrophone(settings({ noiseSuppression: "off" }), {
      getUserMedia: async () => audioStream([audioTrack()]),
    });
    expect(off.noiseSuppression).toBe("none");
  });

  it("does not claim browser suppression when capture reports it disabled", async () => {
    const browser = await captureMicrophone(
      settings({ noiseSuppression: "browser" }),
      {
        getUserMedia: async () =>
          audioStream([audioTrack({ noiseSuppression: false })]),
      },
    );

    expect(browser.noiseSuppression).toBe("none");
  });

  it("resumes the RNNoise context initially and after a browser suspension", async () => {
    let state: AudioContextState = "suspended";
    const resume = vi.fn(async () => {
      state = "running";
    });
    const raw = audioTrack({ noiseSuppression: false });
    const context = {
      get state() {
        return state;
      },
      resume,
      createMediaStreamSource: () => fakeNode(),
      createMediaStreamDestination: destination,
      createGain: gainNode,
      close: vi.fn(async () => {
        state = "closed";
      }),
    } as unknown as AudioContext;
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "rnnoise" }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: () => context,
        attach: async () => handle(),
      },
    );

    expect(resume).toHaveBeenCalledOnce();
    state = "suspended";
    await expect(capture.resume()).resolves.toBe(true);
    expect(resume).toHaveBeenCalledTimes(2);
    capture.dispose();
  });

  it("falls back before attaching RNNoise when its context cannot run", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const attach = vi.fn();
    const close = vi.fn(async () => undefined);
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "rnnoise" }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: () =>
          ({
            state: "suspended",
            resume: vi.fn(async () => undefined),
            close,
          }) as unknown as AudioContext,
        attach,
      },
    );

    expect(attach).not.toHaveBeenCalled();
    expect(capture.noiseSuppression).toBe("browser");
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the raw capture when AudioContext construction throws", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "rnnoise" }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: () => {
          throw new DOMException("rate unsupported", "NotSupportedError");
        },
      },
    );

    expect(capture.track).toBe(raw);
    expect(capture.noiseSuppression).toBe("browser");
    expect(raw.stop).not.toHaveBeenCalled();
  });

  it("does not run fixed-size RNNoise frames at a non-48-kHz context rate", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const attach = vi.fn();
    const close = vi.fn(async () => undefined);
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "rnnoise" }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: () =>
          ({
            state: "running",
            sampleRate: 44_100,
            close,
          }) as unknown as AudioContext,
        attach,
      },
    );

    expect(attach).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(capture.noiseSuppression).toBe("browser");
  });
});

describe("restoreBrowserNoise", () => {
  it("keeps an active voice-isolation constraint while restoring noise suppression", async () => {
    const track = audioTrack({ echoCancellation: "remote-only" });

    await restoreBrowserNoise(track);

    expect(track.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({
        echoCancellation: { exact: "remote-only" },
        noiseSuppression: true,
      }),
    );
  });

  it("trusts an accepted constraint the device does not report on", async () => {
    // `noiseSuppression: undefined` means "not reported", not "off".
    const track = audioTrack({ applyConstraints: async () => {} });
    await expect(restoreBrowserNoise(track)).resolves.toBe("browser");
  });

  it("returns none when the track cannot take constraints at all", async () => {
    const track = { kind: "audio" } as unknown as MediaStreamTrack;
    await expect(restoreBrowserNoise(track)).resolves.toBe("none");
  });
});

describe("captureMicrophone — suppressor engines", () => {
  function runningContext(close = vi.fn(async () => undefined)) {
    return () =>
      ({
        state: "running",
        sampleRate: 48_000,
        createMediaStreamSource: () => fakeNode(),
        createMediaStreamDestination: destination,
        createGain: gainNode,
        close,
      }) as unknown as AudioContext;
  }

  it("asks the attacher for the engine that was chosen", async () => {
    const attach = vi.fn(async (kind: "rnnoise" | "gtcrn" | "speex") => handle(vi.fn(), kind));
    for (const kind of ["gtcrn", "speex", "rnnoise"] as const) {
      const capture = await captureMicrophone(settings({ noiseSuppression: kind }), {
        getUserMedia: async () => audioStream([audioTrack()]),
        createContext: runningContext(),
        attach,
      });
      expect(attach).toHaveBeenLastCalledWith(kind, expect.anything(), expect.anything());
      expect(capture.noiseSuppression).toBe(kind);
      expect(capture.processed).toBe(true);
      capture.dispose();
    }
  });

  it("opens the device with the browser suppressor off for every engine", () => {
    for (const kind of ["gtcrn", "speex", "rnnoise"] as const) {
      expect(microphoneConstraints(settings({ noiseSuppression: kind })).noiseSuppression).toBe(
        false,
      );
    }
  });

  it("restores browser suppression when GTCRN fails, and says so", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const capture = await captureMicrophone(settings({ noiseSuppression: "gtcrn" }), {
      getUserMedia: async () => audioStream([raw]),
      createContext: runningContext(),
      attach: async () => null,
    });
    expect(capture.noiseSuppression).toBe("browser");
    expect(capture.processed).toBe(false);
    expect(capture.track).toBe(raw);
  });
});

describe("captureMicrophone — input gate", () => {
  function gateNode() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      port: { postMessage: vi.fn() },
    } as unknown as AudioWorkletNode & { port: { postMessage: ReturnType<typeof vi.fn> } };
  }

  function runningContext(close = vi.fn(async () => undefined)) {
    return () =>
      ({
        state: "running",
        sampleRate: 48_000,
        createMediaStreamSource: () => fakeNode(),
        createMediaStreamDestination: destination,
        createGain: gainNode,
        close,
      }) as unknown as AudioContext;
  }

  it("builds a graph for the gate alone, without any suppressor", async () => {
    const raw = audioTrack({ noiseSuppression: true });
    const gate = gateNode();
    const createGate = vi.fn(async () => gate);
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "browser", inputGate: true, vadSensitivity: 35 }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: runningContext(),
        createGate,
      },
    );

    expect(createGate).toHaveBeenCalledWith(expect.anything(), 35, {
      gate: true,
      leveller: false,
    });
    expect(capture.gateActive).toBe(true);
    expect(capture.autoGain).toBe("none");
    expect(capture.processed).toBe(true);
    // The peers get the gated destination; the meter listens before the gate.
    expect(capture.track).toBe(lastDestinationTrack());
    expect(capture.monitorStream).not.toBe(capture.stream);
    // Browser suppression stays exactly as requested underneath the gate.
    expect(capture.noiseSuppression).toBe("browser");
    expect(raw.applyConstraints).not.toHaveBeenCalled();
    capture.dispose();
    expect(gate.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(raw.stop).toHaveBeenCalledOnce();
  });

  it("wires suppressor → gate → peers when both are on", async () => {
    const gate = gateNode();
    const suppressor = handle(vi.fn(), "gtcrn");
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "gtcrn", inputGate: true }),
      {
        getUserMedia: async () => audioStream([audioTrack()]),
        createContext: runningContext(),
        attach: async () => suppressor,
        createGate: async () => gate,
      },
    );

    expect(capture.noiseSuppression).toBe("gtcrn");
    expect(capture.gateActive).toBe(true);
    // The suppressor feeds the gate (and the monitor), never the peers directly.
    expect(suppressor.output.connect).toHaveBeenCalledWith(gate);
    expect(gate.connect).toHaveBeenCalledOnce();
    capture.dispose();
  });

  it("retunes the gate in place when sensitivity changes", async () => {
    const gate = gateNode();
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "off", inputGate: true }),
      {
        getUserMedia: async () => audioStream([audioTrack()]),
        createContext: runningContext(),
        createGate: async () => gate,
      },
    );

    capture.setSensitivity(0);
    expect(gate.port.postMessage).toHaveBeenCalledWith({
      type: "config",
      config: expect.objectContaining({ snrOnDb: 14, absoluteFloorDb: -45 }),
    });
    capture.dispose();
  });

  it("admits when the gate could not be built and still sends the suppressed audio", async () => {
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "rnnoise", inputGate: true }),
      {
        getUserMedia: async () => audioStream([audioTrack()]),
        createContext: runningContext(),
        attach: async () => handle(),
        createGate: async () => null,
      },
    );

    expect(capture.gateActive).toBe(false);
    expect(capture.noiseSuppression).toBe("rnnoise");
    expect(capture.monitorStream).toBe(capture.stream);
    capture.dispose();
  });

  it("falls back to the raw device when neither the gate nor the suppressor came up", async () => {
    const raw = audioTrack({ noiseSuppression: false });
    const close = vi.fn(async () => undefined);
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "rnnoise", inputGate: true }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: runningContext(close),
        attach: async () => null,
        createGate: async () => null,
      },
    );

    expect(capture.track).toBe(raw);
    expect(capture.processed).toBe(false);
    expect(capture.gateActive).toBe(false);
    expect(capture.noiseSuppression).toBe("browser");
    expect(close).toHaveBeenCalled();
  });

  it("stays plain when no graph is wanted at all", async () => {
    const createContext = vi.fn(() => null);
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "browser", inputGate: false }),
      { getUserMedia: async () => audioStream([audioTrack()]), createContext },
    );
    expect(createContext).not.toHaveBeenCalled();
    expect(capture.processed).toBe(false);
  });
});

describe("captureMicrophone — automatic volume and fixed gain", () => {
  function detectorNode() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      port: { postMessage: vi.fn() },
    } as unknown as AudioWorkletNode;
  }

  function runningContext(gain = gainNode(), close = vi.fn(async () => undefined)) {
    return () =>
      ({
        state: "running",
        sampleRate: 48_000,
        currentTime: 4,
        createMediaStreamSource: () => fakeNode(),
        createMediaStreamDestination: destination,
        createGain: () => gain,
        close,
      }) as unknown as AudioContext;
  }

  it("builds the detector for automatic volume alone, as a leveller without a gate", async () => {
    const createGate = vi.fn(async () => detectorNode());
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "off", autoGainControl: true }),
      {
        getUserMedia: async () => audioStream([audioTrack()]),
        createContext: runningContext(),
        createGate,
      },
    );

    expect(createGate).toHaveBeenCalledWith(expect.anything(), expect.any(Number), {
      gate: false,
      leveller: true,
    });
    expect(capture.autoGain).toBe("worklet");
    expect(capture.gateActive).toBe(false);
    expect(capture.processed).toBe(true);
    // The meter still listens before the leveller, to what the device delivers.
    expect(capture.monitorStream).not.toBe(capture.stream);
    capture.dispose();
  });

  it("puts the browser's AGC back, and says so, when the detector cannot be built", async () => {
    const raw = audioTrack();
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "off", autoGainControl: true }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: runningContext(),
        createGate: async () => null,
      },
    );

    expect(raw.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ autoGainControl: true }),
    );
    expect(capture.autoGain).toBe("browser");
    expect(capture.processed).toBe(false);
    expect(capture.track).toBe(raw);
  });

  it("restores the browser's AGC underneath a suppressor that did come up", async () => {
    const raw = audioTrack();
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "rnnoise", autoGainControl: true }),
      {
        getUserMedia: async () => audioStream([raw]),
        createContext: runningContext(),
        attach: async () => handle(),
        createGate: async () => null,
      },
    );

    expect(capture.noiseSuppression).toBe("rnnoise");
    expect(capture.autoGain).toBe("browser");
    expect(raw.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ autoGainControl: true }),
    );
    // Noise suppression was never lost, so it is not asked for back.
    expect(raw.applyConstraints).not.toHaveBeenCalledWith(
      expect.objectContaining({ noiseSuppression: true }),
    );
    capture.dispose();
  });

  it("puts a fixed gain first, and alone is reason enough for a graph", async () => {
    const gain = gainNode();
    const attach = vi.fn();
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "off", inputGainDb: 6 }),
      {
        getUserMedia: async () => audioStream([audioTrack()]),
        createContext: runningContext(gain),
        attach,
      },
    );

    expect(capture.processed).toBe(true);
    expect(gain.gain.value).toBeCloseTo(10 ** (6 / 20), 6);
    expect(capture.track).toBe(lastDestinationTrack());
    expect(attach).not.toHaveBeenCalled();
    capture.dispose();
  });

  it("feeds the suppressor from the gain node and retunes the gain live", async () => {
    const gain = gainNode();
    const attach = vi.fn(async () => handle());
    const capture = await captureMicrophone(
      settings({ noiseSuppression: "gtcrn", inputGainDb: 0 }),
      {
        getUserMedia: async () => audioStream([audioTrack()]),
        createContext: runningContext(gain),
        attach,
      },
    );

    expect(attach).toHaveBeenCalledWith("gtcrn", expect.anything(), gain);
    capture.setInputGain(-6);
    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(
      expect.closeTo(10 ** (-6 / 20), 6),
      4,
      expect.any(Number),
    );
    // Out-of-range values are clamped to the slider's range, not trusted.
    capture.setInputGain(90);
    expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      expect.closeTo(10 ** (24 / 20), 6),
      4,
      expect.any(Number),
    );
    capture.dispose();
  });
});

describe("restoreBrowserProcessing", () => {
  it("restores only what was asked for and reports each honestly", async () => {
    const track = audioTrack({ noiseSuppression: false });
    const restored = await restoreBrowserProcessing(track, {
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(track.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ autoGainControl: true }),
    );
    expect(track.applyConstraints).not.toHaveBeenCalledWith(
      expect.objectContaining({ noiseSuppression: true }),
    );
    expect(restored).toEqual({ noiseSuppression: "none", autoGain: "browser" });
  });

  it("does nothing, and claims nothing, when nothing was lost", async () => {
    const track = audioTrack();
    const restored = await restoreBrowserProcessing(track, {
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(restored).toEqual({ noiseSuppression: "none", autoGain: "none" });
  });
});
