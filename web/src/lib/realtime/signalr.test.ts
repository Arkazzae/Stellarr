import { HubConnectionState, type HubConnection } from "@microsoft/signalr";
import { describe, expect, it, vi } from "vitest";
import { RTC_PROTOCOL_VERSION } from "@/lib/rtc/protocol";
import {
  parseSoundboardPlayed,
  parseVoiceSignal,
  SignalRRealtimeClient,
  signalingHubPath,
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

describe("SignalR RTC envelope", () => {
  const signal = {
    protocolVersion: RTC_PROTOCOL_VERSION,
    channelId: "channel-1",
    fromUserId: "user-1",
    toUserId: "user-2",
    kind: "offer",
    payload: '{"type":"offer","sdp":"v=0"}',
  };

  it("accepts the current version", () => {
    expect(parseVoiceSignal(signal)).toEqual(signal);
  });

  it("drops unknown versions and signal kinds at the adapter boundary", () => {
    expect(parseVoiceSignal({ ...signal, protocolVersion: 2 })).toBeNull();
    expect(parseVoiceSignal({ ...signal, kind: "execute" })).toBeNull();
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
