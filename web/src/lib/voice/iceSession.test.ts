import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IceServerConfig, RtcConfig } from "@/lib/api/types";
import {
  IceConfigError,
  RuntimeIceProvider,
  StaticIceProvider,
  TURN_SAFETY_MARGIN_MS,
  evaluateIceFallback,
  turnCredentialExpiry,
} from "./iceSession";

/** A fixed wall-clock so every expiry in this file is exact, not relative. */
const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

/** coturn mints `<unix-expiry>:<userId>` — see `TurnCredentialService`. */
function turnUsername(expiresAtMs: number): string {
  return `${Math.floor(expiresAtMs / 1000)}:9f8e7d6c5b4a3210`;
}

function rtcConfig(expiresAtMs: number): RtcConfig {
  return {
    protocolVersion: 1,
    topology: "mesh",
    capabilities: {
      audioCodecs: ["opus"],
      videoCodecs: [],
      audioProcessing: ["rnnoise"],
      camera: true,
      screenShare: true,
      screenAudio: true,
    },
    signalingHub: "/hubs/app",
    mediaServer: "",
    iceServers: [
      { urls: ["stun:orbit.example:3478"] },
      {
        urls: ["turn:orbit.example:3478?transport=udp"],
        username: turnUsername(expiresAtMs),
        credential: "hmac-of-the-username",
      },
    ],
  };
}

function seedServers(expiresAtMs: number): IceServerConfig[] {
  return rtcConfig(expiresAtMs).iceServers;
}

function turnOf(servers: RTCIceServer[]): RTCIceServer | undefined {
  return servers.find((server) => String(server.urls).includes("turn:"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("turnCredentialExpiry", () => {
  it("reads the Unix expiry that precedes the colon", () => {
    expect(turnCredentialExpiry("1786000000:abc")).toBe(1786000000 * 1000);
  });

  it("returns null for a username that is not time-limited", () => {
    // "No expiry" and "expired" must never be conflated: a static credential is
    // valid forever, a dead one is valid never.
    expect(turnCredentialExpiry("stellarr")).toBeNull();
    expect(turnCredentialExpiry("user:name")).toBeNull();
    expect(turnCredentialExpiry(":1786000000")).toBeNull();
    expect(turnCredentialExpiry("17abc:x")).toBeNull();
  });

  it("returns null for anything that is not a string", () => {
    expect(turnCredentialExpiry(undefined)).toBeNull();
    expect(turnCredentialExpiry(null)).toBeNull();
    expect(turnCredentialExpiry(1786000000)).toBeNull();
  });

  it("rejects a zero or unsafe expiry rather than treating it as valid", () => {
    expect(turnCredentialExpiry("0:abc")).toBeNull();
    expect(turnCredentialExpiry("99999999999999999999:abc")).toBeNull();
  });
});

describe("evaluateIceFallback", () => {
  it("accepts a credential with more than the safety margin left", () => {
    const servers = [
      { urls: ["turn:a"], username: turnUsername(NOW + HOUR), credential: "c" },
    ];
    expect(evaluateIceFallback(servers, NOW)).toEqual({ usable: true, servers });
  });

  it("rejects a credential that has already expired, and drops it", () => {
    const servers = [
      { urls: ["turn:a"], username: turnUsername(NOW - 1), credential: "c" },
    ];
    expect(evaluateIceFallback(servers, NOW)).toEqual({ usable: false, servers: [] });
  });

  it("rejects a credential inside the safety margin, before it actually dies", () => {
    const nearlyDead = NOW + TURN_SAFETY_MARGIN_MS - 1000;
    const servers = [
      { urls: ["turn:a"], username: turnUsername(nearlyDead), credential: "c" },
    ];
    expect(evaluateIceFallback(servers, NOW).usable).toBe(false);
  });

  it("keeps a list with no time-limited credential usable forever", () => {
    // STUN-only has nothing that can go stale.
    const servers = [{ urls: ["stun:a"] }];
    expect(evaluateIceFallback(servers, NOW + 10 * HOUR)).toEqual({
      usable: true,
      servers,
    });
  });

  it("drops the expired entries but keeps the valid ones", () => {
    const good = {
      urls: ["turn:good"],
      username: turnUsername(NOW + HOUR),
      credential: "c",
    };
    const dead = {
      urls: ["turn:dead"],
      username: turnUsername(NOW - HOUR),
      credential: "c",
    };
    const stun = { urls: ["stun:a"] };

    const decision = evaluateIceFallback([stun, dead, good], NOW);

    expect(decision.usable).toBe(true);
    // An expired entry is never handed on: it does not fail loudly, it just
    // never allocates a relay.
    expect(decision.servers).toEqual([stun, good]);
  });

  it("is unusable when every time-limited credential is dead, even beside STUN", () => {
    const stun = { urls: ["stun:a"] };
    const decision = evaluateIceFallback(
      [stun, { urls: ["turn:a"], username: turnUsername(NOW - HOUR), credential: "c" }],
      NOW,
    );
    // STUN alone cannot carry a call through symmetric NAT, so this is not a
    // usable session — but the dead credential is still stripped out.
    expect(decision).toEqual({ usable: false, servers: [stun] });
  });

  it("is unusable when there is nothing cached at all", () => {
    expect(evaluateIceFallback([], NOW)).toEqual({ usable: false, servers: [] });
  });
});

describe("RuntimeIceProvider", () => {
  function provider(fetchRtc: () => Promise<RtcConfig | undefined>) {
    return new RuntimeIceProvider({
      fetchRtc,
      envServers: () => [],
      isProduction: true,
    });
  }

  it("refreshes stale initial credentials when a join starts", async () => {
    // The page loads with a credential good for an hour...
    const initialExpiry = NOW + HOUR;
    const freshExpiry = NOW + 3 * HOUR;
    const fetchRtc = vi.fn(async () => rtcConfig(freshExpiry));

    const ice = provider(fetchRtc);
    ice.seed(seedServers(initialExpiry));
    // ...and it is available for immediate use while it lives.
    expect(turnOf(ice.current())?.username).toBe(turnUsername(initialExpiry));

    // ...but the tab is still open two hours later, when someone joins voice.
    vi.setSystemTime(NOW + 2 * HOUR);
    const servers = await ice.beginSession();

    expect(fetchRtc).toHaveBeenCalledTimes(1);
    expect(turnOf(servers)?.username).toBe(turnUsername(freshExpiry));
    expect(turnOf(ice.current())?.username).toBe(turnUsername(freshExpiry));
  });

  it("fetches once per session however many peers read the list", async () => {
    const fetchRtc = vi.fn(async () => rtcConfig(NOW + HOUR));
    const ice = provider(fetchRtc);

    await ice.beginSession();
    const first = ice.current();
    const second = ice.current();
    const third = ice.current();

    expect(fetchRtc).toHaveBeenCalledTimes(1);
    // Every peer in the call is built from the identical configuration.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("never hands a late-arriving peer an expired active-session credential", async () => {
    const ice = provider(vi.fn(async () => rtcConfig(NOW + HOUR)));
    await ice.beginSession();

    vi.setSystemTime(NOW + HOUR);
    const servers = ice.current();

    expect(turnOf(servers)).toBeUndefined();
    expect(servers.some((server) => String(server.urls).startsWith("stun:"))).toBe(true);
  });

  it("refreshes again on a rejoin after leaving", async () => {
    const fetchRtc = vi
      .fn<() => Promise<RtcConfig>>()
      .mockResolvedValueOnce(rtcConfig(NOW + HOUR))
      .mockResolvedValueOnce(rtcConfig(NOW + 3 * HOUR));
    const ice = provider(fetchRtc);

    await ice.beginSession();
    expect(turnOf(ice.current())?.username).toBe(turnUsername(NOW + HOUR));

    ice.endSession();
    vi.setSystemTime(NOW + 2 * HOUR);
    await ice.beginSession();

    expect(fetchRtc).toHaveBeenCalledTimes(2);
    expect(turnOf(ice.current())?.username).toBe(turnUsername(NOW + 3 * HOUR));
  });

  it("falls back to the cache when the refresh fails but credentials still live", async () => {
    const expiry = NOW + HOUR;
    const fetchRtc = vi
      .fn<() => Promise<RtcConfig>>()
      .mockRejectedValue(new Error("offline"));
    const ice = provider(fetchRtc);
    ice.seed(seedServers(expiry));

    // Half an hour later the credential still has 30 minutes on it.
    vi.setSystemTime(NOW + HOUR / 2);
    const servers = await ice.beginSession();

    expect(turnOf(servers)?.username).toBe(turnUsername(expiry));
    expect(turnOf(servers)?.credential).toBe("hmac-of-the-username");
  });

  it("refuses to start a session on expired credentials when the refresh fails", async () => {
    const expiry = NOW + HOUR;
    const fetchRtc = vi
      .fn<() => Promise<RtcConfig>>()
      .mockRejectedValue(new Error("offline"));
    const ice = provider(fetchRtc);
    ice.seed(seedServers(expiry));

    // Two hours on: the credential died an hour ago.
    vi.setSystemTime(NOW + 2 * HOUR);

    await expect(ice.beginSession()).rejects.toBeInstanceOf(IceConfigError);
    // Retrying keeps reporting the real problem rather than quietly settling
    // for the STUN entry that survives pruning.
    await expect(ice.beginSession()).rejects.toMatchObject({ kind: "expired" });
    await expect(ice.beginSession()).rejects.toMatchObject({ kind: "expired" });
    // No session is cached, and the dead credential is gone from every later
    // read too — nothing can pick it up by accident.
    expect(turnOf(ice.current())).toBeUndefined();
  });

  it("never returns an expired credential from current(), session or not", () => {
    const ice = provider(async () => rtcConfig(NOW + HOUR));
    ice.seed(seedServers(NOW + HOUR));

    // While it is alive the seed is available for immediate use.
    expect(turnOf(ice.current())).toBeDefined();

    // Once it dies, reading again yields the STUN entry and nothing else.
    vi.setSystemTime(NOW + 2 * HOUR);
    expect(turnOf(ice.current())).toBeUndefined();
    expect(ice.current()).toEqual([{ urls: ["stun:orbit.example:3478"] }]);
  });

  it("reports 'unavailable' when the refresh fails with nothing cached", async () => {
    const ice = provider(async () => {
      throw new Error("offline");
    });

    await expect(ice.beginSession()).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("rejects inside the safety margin rather than racing the expiry", async () => {
    const expiry = NOW + HOUR;
    const ice = provider(async () => {
      throw new Error("offline");
    });
    ice.seed(seedServers(expiry));

    // One minute of validity left: technically alive, not worth starting a call on.
    vi.setSystemTime(expiry - 60_000);
    await expect(ice.beginSession()).rejects.toMatchObject({ kind: "expired" });
  });

  it("trusts a freshly fetched list even when the previous one was dead", async () => {
    const ice = provider(async () => rtcConfig(NOW + HOUR));
    ice.seed(seedServers(NOW - HOUR));

    await expect(ice.beginSession()).resolves.toHaveLength(2);
  });

  it("accepts an empty server list from the server as a real answer", async () => {
    const ice = provider(async () => ({ ...rtcConfig(NOW + HOUR), iceServers: [] }));
    ice.seed(seedServers(NOW + HOUR));

    // An instance that runs no coturn is a valid configuration, not a failure.
    await expect(ice.beginSession()).resolves.toEqual([]);
    expect(ice.current()).toEqual([]);
  });

  it("survives a bootstrap payload with no rtc block", async () => {
    const ice = provider(async () => undefined);
    await expect(ice.beginSession()).resolves.toEqual([]);
  });

  it("keeps a STUN-only cache usable a day after the refresh breaks", async () => {
    const ice = new RuntimeIceProvider({
      fetchRtc: async () => {
        throw new Error("offline");
      },
      envServers: () => [],
      isProduction: true,
    });
    ice.seed([{ urls: ["stun:orbit.example:3478"] }]);

    vi.setSystemTime(NOW + 24 * HOUR);
    await expect(ice.beginSession()).resolves.toEqual([
      { urls: ["stun:orbit.example:3478"] },
    ]);
  });

  it("uses the injected clock when one is supplied", async () => {
    const ice = new RuntimeIceProvider({
      fetchRtc: async () => {
        throw new Error("offline");
      },
      envServers: () => [],
      isProduction: true,
      now: () => NOW + 2 * HOUR,
    });
    ice.seed(seedServers(NOW + HOUR));

    await expect(ice.beginSession()).rejects.toMatchObject({ kind: "expired" });
  });
});

describe("StaticIceProvider", () => {
  it("hands back the same list without any refresh", async () => {
    const servers = [{ urls: ["stun:a"] }];
    const ice = new StaticIceProvider(servers);

    await expect(ice.beginSession()).resolves.toBe(servers);
    ice.endSession();
    expect(ice.current()).toBe(servers);
  });
});
