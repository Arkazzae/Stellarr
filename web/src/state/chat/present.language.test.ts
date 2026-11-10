import { describe, expect, it } from "vitest";

import { buildTranscript } from "@/lib/format";
import { message } from "@/test/messages";

import { presentTranscript, type PresentationContext } from "./present";

const NOW = new Date("2026-01-01T13:00:00Z");

function context(extFallback: string): PresentationContext {
  return {
    selfId: undefined,
    server: { name: "Orbit" },
    faces: new Map(),
    customEmoji: new Map(),
    mentions: new Map(),
    pinnedIds: new Set(),
    reactionsOf: () => [],
    extFallback,
  };
}

describe("a transcript presented for a reader", () => {
  it("gives a file with no extension the badge in the reader's language", () => {
    const file = {
      id: "a1",
      url: "https://cdn/a1",
      name: "README",
      contentType: "application/octet-stream",
      size: 12,
    };
    const messages = [message("m1", 1, { content: "", attachments: [file] })];

    const [section] = presentTranscript(buildTranscript(messages, NOW, "en"), context("FILE"));

    expect(section?.groups[0]?.bodies[0]?.parts).toMatchObject([{ kind: "file", ext: "FILE" }]);
  });
});
