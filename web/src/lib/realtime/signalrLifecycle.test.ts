import { HubConnectionState, type HubConnection } from "@microsoft/signalr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_SERVER_STORAGE_KEY } from "@/lib/api/client";
import { HUB_DECODERS } from "./hubPayloads";
import { SignalRRealtimeClient } from "./signalr";

interface FakeHub {
  connection: HubConnection;
  handlers: Map<string, (payload: unknown) => void>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
  fire: { reconnecting(): void; reconnected(): void; close(): void };
}

/** A hub whose `start` can be held open or made to fail. */
function fakeHub(start: () => Promise<void> = async () => undefined): FakeHub {
  const handlers = new Map<string, (payload: unknown) => void>();
  const listeners: Record<"reconnecting" | "reconnected" | "close", () => void> = {
    reconnecting: () => undefined,
    reconnected: () => undefined,
    close: () => undefined,
  };
  const hub = {
    state: HubConnectionState.Disconnected as HubConnectionState,
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    }),
    onreconnecting: vi.fn((listener: () => void) => void (listeners.reconnecting = listener)),
    onreconnected: vi.fn((listener: () => void) => void (listeners.reconnected = listener)),
    onclose: vi.fn((listener: () => void) => void (listeners.close = listener)),
    start: vi.fn(async () => {
      await start();
      hub.state = HubConnectionState.Connected;
    }),
    stop: vi.fn(async () => {
      hub.state = HubConnectionState.Disconnected;
    }),
    invoke: vi.fn(async (method: string, ...args: unknown[]) => [method, args]),
  };
  return {
    connection: hub as unknown as HubConnection,
    handlers,
    start: hub.start,
    stop: hub.stop,
    invoke: hub.invoke,
    fire: {
      reconnecting: () => listeners.reconnecting(),
      reconnected: () => listeners.reconnected(),
      close: () => {
        hub.state = HubConnectionState.Disconnected;
        listeners.close();
      },
    },
  };
}

function clientWith(...hubs: FakeHub[]) {
  const queue = [...hubs];
  const factory = vi.fn((url: string) => {
    void url;
    const next = queue.shift();
    if (!next) throw new Error("no more fake hubs");
    return next.connection;
  });
  return { client: new SignalRRealtimeClient(factory), factory };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem(ACTIVE_SERVER_STORAGE_KEY);
});

describe("SignalRRealtimeClient status", () => {
  it("walks through connecting, reconnecting and back to connected", async () => {
    const hub = fakeHub();
    const { client } = clientWith(hub);
    const seen: string[] = [];
    client.subscribeStatus(() => seen.push(client.getStatus()));

    await client.start();
    hub.fire.reconnecting();
    hub.fire.reconnected();
    await client.stop();

    expect(seen).toEqual(["connecting", "connected", "reconnecting", "connected", "idle"]);
  });

  it("registers a handler for every realtime event", async () => {
    const hub = fakeHub();
    const { client } = clientWith(hub);
    await client.start();

    expect([...hub.handlers.keys()].sort()).toEqual(Object.keys(HUB_DECODERS).sort());
  });

  it("does not forward a malformed payload to subscribers", async () => {
    const hub = fakeHub();
    const { client } = clientWith(hub);
    const created = vi.fn();
    client.on("MessageCreated", created);
    await client.start();

    hub.handlers.get("MessageCreated")?.({ id: "no author" });

    expect(created).not.toHaveBeenCalled();
  });

  it("keeps subscribers attached across a stop and a start", async () => {
    const first = fakeHub();
    const second = fakeHub();
    const { client } = clientWith(first, second);
    const typing = vi.fn();
    client.on("TypingChanged", typing);

    await client.start();
    await client.stop();
    await client.start();
    second.handlers.get("TypingChanged")?.({
      channelId: "c1",
      userId: "u1",
      displayName: "Ada",
      expiresAt: "2026-09-01T14:00:05.000Z",
    });

    expect(typing).toHaveBeenCalledTimes(1);
  });
});

describe("SignalRRealtimeClient hub address", () => {
  it("appends the active server to the configured hub", async () => {
    window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, "server 1");
    const { client, factory } = clientWith(fakeHub());
    client.configureRtc({ signalingHub: "/hubs/rtc-v2" });

    await client.start();

    expect(factory).toHaveBeenCalledWith("/hubs/rtc-v2?serverId=server%201");
  });

  it("extends an existing query string with &", async () => {
    window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, "s1");
    const { client, factory } = clientWith(fakeHub());
    client.configureRtc({ signalingHub: "/hubs/rtc?v=2" });

    await client.start();

    expect(factory).toHaveBeenCalledWith("/hubs/rtc?v=2&serverId=s1");
  });

  it("uses the bare hub when no server is active", async () => {
    const { client, factory } = clientWith(fakeHub());
    await client.start();
    expect(factory).toHaveBeenCalledWith("/hubs/app");
  });

  it("ignores a hub configured while a connection exists", async () => {
    const { client, factory } = clientWith(fakeHub(), fakeHub(), fakeHub());
    await client.start();
    client.configureRtc({ signalingHub: "/hubs/late" });
    await client.stop();
    await client.start();
    expect(factory).toHaveBeenNthCalledWith(2, "/hubs/app");

    await client.stop();
    client.configureRtc({ signalingHub: "/hubs/late" });
    await client.start();
    expect(factory).toHaveBeenNthCalledWith(3, "/hubs/late");
  });
});

describe("SignalRRealtimeClient restarts", () => {
  it("reports a failed negotiation and retries with a backoff of at least a second", async () => {
    const failing = fakeHub(async () => {
      throw new Error("offline");
    });
    const recovered = fakeHub();
    const { client, factory } = clientWith(failing, recovered);

    await expect(client.start()).rejects.toThrow("offline");
    expect(client.getStatus()).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(999);
    expect(factory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(client.getStatus()).toBe("connected");
  });

  it("backs off further while negotiation keeps failing", async () => {
    const attempt = () =>
      fakeHub(async () => {
        throw new Error("offline");
      });
    const { client, factory } = clientWith(attempt(), attempt(), attempt());

    await client.start().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(factory).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(factory).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(factory).toHaveBeenCalledTimes(3);
    await client.stop();
  });

  it("restarts after the connection closes for good", async () => {
    const first = fakeHub();
    const second = fakeHub();
    const { client, factory } = clientWith(first, second);
    await client.start();

    first.fire.close();
    expect(client.getStatus()).toBe("disconnected");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(client.getStatus()).toBe("connected");
  });

  it("does not restart once stopped", async () => {
    const first = fakeHub();
    const { client, factory } = clientWith(first, fakeHub());
    await client.start();
    first.fire.close();

    await client.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe("idle");
  });

  it("closes a negotiation that finishes after a stop", async () => {
    let finish: () => void = () => undefined;
    const slow = fakeHub(
      () => new Promise<void>((resolve) => void (finish = resolve)),
    );
    const { client } = clientWith(slow);
    const starting = client.start();

    await client.stop();
    finish();
    await starting;

    expect(slow.stop).toHaveBeenCalled();
    expect(client.getStatus()).toBe("idle");
  });
});

describe("SignalRRealtimeClient voice occupancy", () => {
  const frame = (sequence: number) => ({
    channelId: "voice-1",
    sequence,
    participants: [{ userId: "u1", displayName: "Ada" }],
  });

  it("accepts an older sequence again after the connection recovers", async () => {
    const hub = fakeHub();
    const { client } = clientWith(hub);
    const changed = vi.fn();
    client.on("VoiceParticipantChanged", changed);
    await client.start();

    hub.handlers.get("VoiceParticipantChanged")?.(frame(40));
    hub.fire.reconnected();
    hub.handlers.get("VoiceParticipantChanged")?.(frame(1));

    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("tracks sequences per room", async () => {
    const hub = fakeHub();
    const { client } = clientWith(hub);
    const changed = vi.fn();
    client.on("VoiceParticipantChanged", changed);
    await client.start();

    hub.handlers.get("VoiceParticipantChanged")?.(frame(5));
    hub.handlers.get("VoiceParticipantChanged")?.({ ...frame(2), channelId: "voice-2" });

    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe("SignalRRealtimeClient calls", () => {
  it("refuses to call the hub before it is open", async () => {
    const { client } = clientWith(fakeHub());
    await expect(client.joinVoice("voice-1")).rejects.toThrow(
      "Cannot call JoinVoice: realtime connection is not open",
    );
  });

  it("forwards calls to the hub methods once connected", async () => {
    const hub = fakeHub();
    const { client } = clientWith(hub);
    await client.start();

    await client.setPresence("idle");
    await client.joinChannel("c1");
    await client.playSoundboard("voice-1", "sound-1");
    await client.leaveVoice();

    expect(hub.invoke.mock.calls).toEqual([
      ["SetPresence", "idle"],
      ["JoinChannel", "c1"],
      ["PlaySoundboard", "voice-1", "sound-1"],
      ["LeaveVoice"],
    ]);
  });

  it("returns the clock the hub answers with", async () => {
    const hub = fakeHub();
    hub.invoke.mockResolvedValueOnce(1_800_000_000_000);
    const { client } = clientWith(hub);
    await client.start();

    await expect(client.getRtcClock()).resolves.toBe(1_800_000_000_000);
  });
});
