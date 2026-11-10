import { afterEach, describe, expect, it, vi } from "vitest";

import { iceServers } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("iceServers", () => {
  it("reads the servers from the environment as JSON", () => {
    vi.stubEnv("NEXT_PUBLIC_ICE_SERVERS", '[{"urls":"stun:stun.example.org:3478"}]');

    expect(iceServers()).toEqual([{ urls: "stun:stun.example.org:3478" }]);
  });

  it("yields none when the variable is unset or empty", () => {
    vi.stubEnv("NEXT_PUBLIC_ICE_SERVERS", "");

    expect(iceServers()).toEqual([]);
  });

  it.each([["not json"], ['{"urls":"stun:a"}'], ['"stun:a"']])(
    "yields none for %s, which is not a JSON array",
    (raw) => {
      vi.stubEnv("NEXT_PUBLIC_ICE_SERVERS", raw);

      expect(iceServers()).toEqual([]);
    },
  );
});
