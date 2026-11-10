import { describe, expect, it } from "vitest";
import type { IceServerConfig } from "@/lib/api/types";
import { resolveIceServers } from "./iceConfig";

/** Shaped exactly like what `/api/bootstrap` sends (see `RtcConfigurationDto`). */
const RUNTIME: IceServerConfig[] = [
  { urls: ["stun:orbit.example:3478"] },
  {
    urls: [
      "turn:orbit.example:3478?transport=udp",
      "turn:orbit.example:3478?transport=tcp",
    ],
    username: "1786000000:9f8e7d6c5b4a3210",
    credential: "kJ8s+Wm3Qz1r/AbCdEfGhIjKlM=",
  },
];

const ENV: RTCIceServer[] = [{ urls: "stun:build-time.example:3478" }];

describe("resolveIceServers", () => {
  it("uses the runtime list from bootstrap as the primary configuration", () => {
    const resolved = resolveIceServers({
      runtime: RUNTIME,
      env: ENV,
      isProduction: true,
    });

    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toEqual({ urls: ["stun:orbit.example:3478"] });
  });

  it("preserves per-user TURN credentials byte for byte", () => {
    const [, turn] = resolveIceServers({
      runtime: RUNTIME,
      env: ENV,
      isProduction: true,
    });

    // coturn recomputes the HMAC over the username, so any normalisation of
    // either half — trimming, re-casing, re-encoding — fails authentication.
    expect(turn?.username).toBe("1786000000:9f8e7d6c5b4a3210");
    expect(turn?.credential).toBe("kJ8s+Wm3Qz1r/AbCdEfGhIjKlM=");
    expect(turn?.urls).toEqual([
      "turn:orbit.example:3478?transport=udp",
      "turn:orbit.example:3478?transport=tcp",
    ]);
  });

  it("ignores the build-time list whenever the server supplied one", () => {
    const resolved = resolveIceServers({
      runtime: RUNTIME,
      env: ENV,
      isProduction: false,
    });

    expect(
      resolved.some((server) => String(server.urls).includes("build-time")),
    ).toBe(false);
  });

  it("returns nothing in production when the server supplied nothing", () => {
    // Substituting a stale build-time list here would mask a server
    // misconfiguration behind calls that fail only behind symmetric NAT.
    expect(resolveIceServers({ runtime: [], env: ENV, isProduction: true })).toEqual([]);
    expect(
      resolveIceServers({ runtime: undefined, env: ENV, isProduction: true }),
    ).toEqual([]);
  });

  it("falls back to the env list only in development", () => {
    const resolved = resolveIceServers({
      runtime: [],
      env: ENV,
      isProduction: false,
    });
    expect(resolved).toEqual([{ urls: "stun:build-time.example:3478" }]);
  });

  it("copies the env entries so a caller cannot mutate the build-time constant", () => {
    const [entry] = resolveIceServers({ env: ENV, isProduction: false });
    expect(entry).not.toBe(ENV[0]);
    expect(entry).toEqual(ENV[0]);
  });

  it("returns an empty list when there is nothing anywhere", () => {
    expect(resolveIceServers({ isProduction: false })).toEqual([]);
    expect(resolveIceServers({ isProduction: true })).toEqual([]);
  });

  it("accepts a single url string as well as an array", () => {
    const resolved = resolveIceServers({
      runtime: [{ urls: "stun:one.example:3478" } as unknown as IceServerConfig],
      isProduction: true,
    });
    expect(resolved).toEqual([{ urls: ["stun:one.example:3478"] }]);
  });

  it("drops entries with no usable URL rather than throwing at the constructor", () => {
    const resolved = resolveIceServers({
      runtime: [
        { urls: [] },
        { urls: [""] },
        { urls: ["turn:good.example:3478"], username: "u", credential: "c" },
      ],
      isProduction: true,
    });
    // RTCPeerConnection throws on a malformed urls value, which would take down
    // the whole call rather than one server.
    expect(resolved).toEqual([
      { urls: ["turn:good.example:3478"], username: "u", credential: "c" },
    ]);
  });

  it("omits a half-filled credential pair instead of sending one coturn rejects", () => {
    const resolved = resolveIceServers({
      runtime: [
        { urls: ["turn:a.example:3478"], username: "only-user" },
        { urls: ["turn:b.example:3478"], credential: "only-secret" },
      ],
      isProduction: true,
    });

    expect(resolved).toEqual([
      { urls: ["turn:a.example:3478"] },
      { urls: ["turn:b.example:3478"] },
    ]);
  });

  it("keeps STUN and TURN in the order the server listed them", () => {
    const resolved = resolveIceServers({ runtime: RUNTIME, isProduction: true });
    expect(String(resolved[0]?.urls)).toContain("stun:");
    expect(String(resolved[1]?.urls)).toContain("turn:");
  });
});
