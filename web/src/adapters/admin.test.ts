import { describe, expect, it, vi } from "vitest";

import type { AdminApiClient } from "@/lib/api/client";

import { createServerAdminAdapter } from "./admin";

describe("server admin adapter", () => {
  it("persists the server profile and updates the shared directory", async () => {
    const server = {
      id: "s-1",
      name: "Nowa Orbita",
      description: "Opis",
      createdAt: "2026-07-12T12:00:00Z",
      isPublic: true,
    };
    const updateServer = vi.fn(async () => server);
    const changed = vi.fn();
    const adapter = createServerAdminAdapter(
      { updateServer } as unknown as AdminApiClient,
      () => ["manageServer"],
      vi.fn(),
      undefined,
      changed,
    );

    expect(adapter.supported.server).toBe(true);
    await adapter.updateServer({ name: "Nowa Orbita", isPublic: true });

    expect(updateServer).toHaveBeenCalledWith({ name: "Nowa Orbita", isPublic: true });
    expect(changed).toHaveBeenCalledWith(server);
  });
});
