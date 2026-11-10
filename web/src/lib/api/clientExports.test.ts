import { describe, expect, it } from "vitest";

import * as client from "./client";
import * as parsers from "./parsers";
import { ACTIVE_SERVER_STORAGE_KEY } from "./transport";

// The realtime layer, the adapters and the desktop bridge import these names
// from `@/lib/api/client`, whatever module they live in.
describe("@/lib/api/client", () => {
  it("re-exports the storage key of the active server", () => {
    expect(client.ACTIVE_SERVER_STORAGE_KEY).toBe(ACTIVE_SERVER_STORAGE_KEY);
  });

  it.each([
    "parseUser",
    "parseMessage",
    "parseEmbedsUpdate",
    "parseReactionChanged",
    "parseMessageHistoryPage",
    "parseMessageSyncPage",
    "parseThreadSummary",
    "parseSoundboardSound",
    "parseServer",
    "parseChannelRead",
  ] as const)("re-exports %s", (name) => {
    expect(client[name]).toBe(parsers[name]);
  });
});
