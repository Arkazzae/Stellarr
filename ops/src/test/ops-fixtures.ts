import { vi } from "vitest";

import type { OpsBootstrap } from "@/lib/api";
import type { OpsContextValue } from "@/state/ops-context";

function bootstrapFixture(): OpsBootstrap {
  return {
    operator: { id: "op-1", username: "owner", displayName: "Ola Owner", avatarUrl: null },
    instance: { id: "inst-1", name: "Domek", createdAt: "2025-01-01T00:00:00Z" },
    overview: {
      userCount: 3,
      onlineUserCount: 1,
      realtimeConnectionCount: 1,
      storedObjectBytes: 0,
      messageCount: 12,
    },
  };
}

/** A ready session whose actions are spies; override the phase to test the other screens. */
export function opsValue(overrides: Partial<OpsContextValue> = {}): OpsContextValue {
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
