import { vi } from "vitest";

import type { AdminApiClient, ApiClient, SocialApiClient } from "@/lib/api/client";

import { fakeApi } from "./fakes";

export type FullApi = ApiClient & SocialApiClient & AdminApiClient;

/**
 * `fakeApi` covers the core client only. A runtime also reads the social state
 * on hydrate and persists channel and section order, so those members are added
 * here. Anything a test does not override and does not reach is left absent.
 */
export function fullApi(overrides: Partial<FullApi> = {}): FullApi {
  return {
    ...fakeApi(),
    getSocialState: vi.fn(async () => ({
      friends: [],
      requests: [],
      blocked: [],
      conversations: [],
    })),
    reorderChannels: vi.fn(async () => {}),
    reorderSections: vi.fn(async () => {}),
    ...overrides,
  } as unknown as FullApi;
}
