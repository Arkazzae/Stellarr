import { vi } from "vitest";

import type { CockpitBootstrap } from "@/lib/api";
import type { CockpitContextValue } from "@/state/cockpit-context";

function bootstrapFixture(): CockpitBootstrap {
  return {
    operator: { id: "op-1", username: "owner", displayName: "Ola Owner", avatarUrl: null },
    instance: { id: "inst-1", name: "Domek", createdAt: "2025-01-01T00:00:00Z" },
    overview: {
      userCount: 3,
      onlineUserCount: 1,
      realtimeConnectionCount: 1,
      storedObjectBytes: 0,
      messageCount: 12,
      serverCount: 2,
      publicServerCount: 1,
    },
  };
}

/** A ready session whose actions are spies; override the phase to test the other screens. */
export function cockpitValue(overrides: Partial<CockpitContextValue> = {}): CockpitContextValue {
  return {
    phase: "ready",
    bootstrap: bootstrapFixture(),
    error: null,
    reload: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
