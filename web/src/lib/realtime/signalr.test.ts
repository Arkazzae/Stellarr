import { HubConnectionState, LogLevel, type HubConnection } from "@microsoft/signalr";
import { describe, expect, it, vi } from "vitest";
import { RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
import {
  parseMediaSessionClosed,
  parseMediaSignal,
  parseSoundboardPlayed,
  parseVoiceSignal,
  SignalRRealtimeClient,
  signalingHubPath,
  signalRLogger,
  signalRRetryDelay,
} from "./signalr";

describe("SignalR connection policy", () => {
  it("keeps retrying at a bounded cadence after the initial backoff", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(signalRRetryDelay)).toEqual([
      0,
      2_000,
      5_000,
      10_000,
      20_000,
      30_000,
      30_000,
    ]);
  });

  it("accepts only same-origin hub paths from bootstrap", () => {
    expect(signalingHubPath("/hubs/rtc-v2")).toBe("/hubs/rtc-v2");
    expect(signalingHubPath("//evil.example/hub")).toBe("/hubs/app");
    expect(signalingHubPath("/\\evil.example/hub")).toBe("/hubs/app");
    expect(signalingHubPath("https://evil.example/hub")).toBe("/hubs/app");
  });

  it("serializes a new start behind an older stop", async () => {
    let finishFirstStop: (() => void) | undefined;
    const firstStop = new Promise<void>((resolve) => {
      finishFirstStop = resolve;
    });
    const connection = (stop: () => Promise<void>): HubConnection => ({
      state: HubConnectionState.Disconnected,
      on: vi.fn(),
      onreconnecting: vi.fn(),
      onreconnected: vi.fn(),
      onclose: vi.fn(),
      start: vi.fn(async () => undefined),
      stop: vi.fn(stop),
      invoke: vi.fn(async () => undefined),
    } as unknown as HubConnection);
    const connections = [
      connection(() => firstStop),
      connection(async () => undefined),
    ];
    const factory = vi.fn(() => connections.shift()!);
    const client = new SignalRRealtimeClient(factory);

    await client.start();
    const stopping = client.stop();
    const restarting = client.start();
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);

    finishFirstStop?.();
    await stopping;
    await restarting;
    expect(factory).toHaveBeenCalledTimes(2);
    expect(client.getStatus()).toBe("connected");
  });

  it("accepts only well-formed private inbox invalidations", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const connection = {
      state: HubConnectionState.Disconnected,
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler);
      }),
      onreconnecting: vi.fn(),
      onreconnected: vi.fn(),
      onclose: vi.fn(),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      invoke: vi.fn(async () => undefined),
    } as unknown as HubConnection;
    const client = new SignalRRealtimeClient(() => connection);
    const changed = vi.fn();
    client.on("NotificationInboxChanged", changed);
    await client.start();

    handlers.get("NotificationInboxChanged")?.({ serverId: "server-1", sequence: 12 });
    handlers.get("NotificationInboxChanged")?.({ serverId: "server-2", global: true });
    handlers.get("NotificationInboxChanged")?.({ serverId: "server-1", sequence: "12" });
    handlers.get("NotificationInboxChanged")?.({ sequence: 13 });

    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenNthCalledWith(1, { serverId: "server-1", sequence: 12 });
    expect(changed).toHaveBeenNthCalledWith(2, { serverId: "server-2", global: true });
  });

  it("drops reordered voice occupancy snapshots", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const connection = {
      state: HubConnectionState.Disconnected,
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler);
      }),
      onreconnecting: vi.fn(),
      onreconnected: vi.fn(),
      onclose: vi.fn(),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      invoke: vi.fn(async () => undefined),
    } as unknown as HubConnection;
    const client = new SignalRRealtimeClient(() => connection);
    const changed = vi.fn();
    client.on("VoiceParticipantChanged", changed);
    await client.start();

    const emit = (sequence: number, userIds: string[]) =>
      handlers.get("VoiceParticipantChanged")?.({
        channelId: "voice-1",
        sequence,
        participants: userIds.map((userId) => ({ userId, displayName: userId })),
      });
    emit(8, ["u-a", "u-b"]);
    emit(7, ["u-a"]);
    emit(8, []);
    emit(9, ["u-a", "u-b", "u-c"]);

    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls.map(([event]) => event.sequence)).toEqual([8, 9]);
    expect(changed.mock.calls[1]?.[0].participants).toHaveLength(3);
  });
});

describe("SignalR logging", () => {
  it("drops the abort our own stop() causes and keeps every other problem", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      signalRLogger.log(LogLevel.Error, "Failed to start the HttpConnection before stop() was called.");
      expect(error).not.toHaveBeenCalled();

      signalRLogger.log(LogLevel.Error, "Failed to complete negotiation with the server: 503");
      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0]?.[0]).toMatch(/\] Error: Failed to complete negotiation/);

      signalRLogger.log(LogLevel.Warning, "Connection disconnected with error.");
      expect(warn).toHaveBeenCalledOnce();

      signalRLogger.log(LogLevel.Information, "WebSocket connected.");
      expect(error).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("SignalR RTC envelope", () => {
  const signal = {
    protocolVersion: RTC_PROTOCOL_VERSION,
    channelId: "channel-1",
    fromUserId: "user-1",
    toUserId: "user-2",
    kind: "state",
    payload: '{"muted":false,"screenStreamId":null,"cameraStreamId":null}',
  };

  it("accepts the current version", () => {
    expect(parseVoiceSignal(signal)).toEqual(signal);
  });

  it("drops unknown versions and signal kinds at the adapter boundary", () => {
    expect(parseVoiceSignal({ ...signal, protocolVersion: 2 })).toBeNull();
    expect(parseVoiceSignal({ ...signal, kind: "execute" })).toBeNull();
  });

  it("drops a description or candidate, which only the media server takes", () => {
    for (const kind of ["offer", "answer", "candidate"]) {
      expect(parseVoiceSignal({ ...signal, kind })).toBeNull();
    }
  });
});

describe("SignalR soundboard envelope", () => {
  const event = {
    playbackId: "play-1",
    channelId: "voice-1",
    triggeredByUserId: "user-1",
    startsAtUnixMs: 1_800_000_000_750,
    sound: {
      id: "sound-1",
      name: "Ping",
      glyph: "🔔",
      url: "/assets/audio-1",
      durationSeconds: 3,
      trimStartSeconds: 0.5,
      trimEndSeconds: 2,
    },
  };

  it("accepts a scheduled trimmed clip", () => {
    expect(parseSoundboardPlayed(event)).toEqual(event);
  });

  it("drops an event without a finite shared start time", () => {
    expect(parseSoundboardPlayed({ ...event, startsAtUnixMs: "soon" })).toBeNull();
  });
});

describe("SignalR media session", () => {
  /** A connection that opens for real, so `invoke` reaches the hub. */
  function openConnection(invoke: (method: string, ...args: unknown[]) => Promise<unknown>) {
    const handlers = new Map<string, (payload: unknown) => void>();
    const connection = {
      state: HubConnectionState.Disconnected,
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler);
      }),
      onreconnecting: vi.fn(),
      onreconnected: vi.fn(),
      onclose: vi.fn(),
      start: vi.fn(async () => {
        connection.state = HubConnectionState.Connected;
      }),
      stop: vi.fn(async () => undefined),
      invoke: vi.fn(invoke),
    };
    const client = new SignalRRealtimeClient(() => connection as unknown as HubConnection);
    return { client, connection, handlers };
  }

  it("opens a session for the seat and returns its id", async () => {
    const { client, connection } = openConnection(async () => ({ sessionId: "session-7" }));
    await client.start();

    await expect(client.openMediaSession("voice-1")).resolves.toBe("session-7");
    expect(connection.invoke).toHaveBeenCalledWith("OpenMediaSession", "voice-1");
  });

  it("refuses a hub answer that carries no session id", async () => {
    const { client } = openConnection(async () => ({ id: "session-7" }));
    await client.start();

    await expect(client.openMediaSession("voice-1")).rejects.toThrow("no session id");
  });

  it("passes on the hub's refusal", async () => {
    const { client } = openConnection(async () => {
      throw new Error("Media server is unavailable.");
    });
    await client.start();

    await expect(client.openMediaSession("voice-1")).rejects.toThrow("unavailable");
  });

  it("sends a media signal through SendMediaSignal unchanged", async () => {
    const { client, connection } = openConnection(async () => undefined);
    await client.start();
    const signal = {
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: "voice-1",
      sessionId: "session-7",
      kind: "candidate" as const,
      payload: "null",
    };

    await client.sendMediaSignal(signal);

    expect(connection.invoke).toHaveBeenCalledWith("SendMediaSignal", signal);
  });

  it("relays only well-formed signals and closures from the media server", async () => {
    const { client, handlers } = openConnection(async () => undefined);
    const signals = vi.fn();
    const closures = vi.fn();
    client.on("MediaSignal", signals);
    client.on("MediaSessionClosed", closures);
    await client.start();
    const signal = {
      protocolVersion: RTC_PROTOCOL_VERSION,
      channelId: "voice-1",
      sessionId: "session-7",
      kind: "answer",
      payload: '{"type":"answer","sdp":"v=0"}',
    };

    handlers.get("MediaSignal")?.(signal);
    handlers.get("MediaSignal")?.({ ...signal, kind: "candidate" });
    handlers.get("MediaSignal")?.({ ...signal, protocolVersion: 2 });
    handlers.get("MediaSessionClosed")?.({
      channelId: "voice-1",
      sessionId: "session-7",
      reason: "media-restarted",
    });
    handlers.get("MediaSessionClosed")?.({ channelId: "voice-1", sessionId: "session-7" });

    expect(signals.mock.calls).toEqual([[signal]]);
    expect(closures.mock.calls).toEqual([
      [{ channelId: "voice-1", sessionId: "session-7", reason: "media-restarted" }],
    ]);
  });

  it("re-exports the media parsers next to the voice ones", () => {
    expect(parseMediaSignal(null)).toBeNull();
    expect(parseMediaSessionClosed(null)).toBeNull();
  });
});
