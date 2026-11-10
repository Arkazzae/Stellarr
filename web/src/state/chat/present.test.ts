import { describe, expect, it } from "vitest";

import { buildTranscript } from "@/lib/format";
import type { Message, User } from "@/ports";
import { at, message } from "@/test/messages";

import {
  memberFaces,
  mentionTargets,
  pinnedRows,
  presentTranscript,
  type PresentationContext,
} from "./present";

const NOW = new Date("2026-01-01T13:00:00Z");
const ADA: User = { id: "u-ada", username: "Ada", displayName: "Ada L.", presence: "online", avatarUrl: "/a.png" };
const BOB: User = { id: "u-bob", username: "bob", displayName: "Bob", presence: "idle" };

const context = (overrides: Partial<PresentationContext> = {}): PresentationContext => ({
  selfId: "u-ada",
  server: { name: "Orbit", iconUrl: "/orbit.png" },
  faces: new Map([["u-ada", "/a.png"]]),
  customEmoji: new Map(),
  mentions: new Map(),
  pinnedIds: new Set(),
  reactionsOf: () => [],
  extFallback: "FILE",
  ...overrides,
});

function present(messages: Message[], overrides: Partial<PresentationContext> = {}) {
  return presentTranscript(buildTranscript(messages, NOW, "en"), context(overrides));
}

const groups = (messages: Message[], overrides: Partial<PresentationContext> = {}) =>
  present(messages, overrides).flatMap((section) => section.groups);

describe("presentTranscript", () => {
  it("marks your own blocks and gives authors their picture", () => {
    const [mine, theirs] = groups([
      message("a", 1),
      message("b", 20, { author: { id: "u-bob", displayName: "Bob" } }),
    ]);
    expect(mine).toMatchObject({ id: "a", authorId: "u-ada", own: true, authorAvatarUrl: "/a.png" });
    expect(theirs?.own).toBeUndefined();
    expect(theirs?.authorAvatarUrl).toBeUndefined();
  });

  it("marks nothing as yours while nobody is signed in", () => {
    expect(groups([message("a", 1)], { selfId: undefined })[0]?.own).toBeUndefined();
  });

  it("shows server notices under the server's name and icon", () => {
    const [notice] = groups([
      message("n", 1, { author: { id: "system", displayName: "system" } }),
    ]);
    expect(notice).toMatchObject({
      authorName: "Orbit",
      authorAvatarUrl: "/orbit.png",
      system: true,
    });
  });

  it("names the answered message on the block that answers it", () => {
    const answered = { id: "a", authorId: "u-ada", authorName: "Ada", preview: "hi" };
    const [, reply] = groups([message("a", 1), message("r", 30, { replyTo: answered })]);
    expect(reply?.replyTo).toEqual(answered);
  });

  it("carries one body per message with its pin marker and reactions", () => {
    const reactions = [{ emoji: "👍", count: 2, mine: false }];
    const [group] = groups([message("a", 1), message("b", 2)], {
      pinnedIds: new Set(["b"]),
      reactionsOf: (id) => (id === "a" ? reactions : []),
    });
    expect(group?.bodies.map((body) => body.id)).toEqual(["a", "b"]);
    expect(group?.bodies[0]).toMatchObject({ reactions });
    expect(group?.bodies[0]?.pinned).toBeUndefined();
    expect(group?.bodies[1]).toMatchObject({ pinned: true });
    expect(group?.bodies[1]?.reactions).toBeUndefined();
  });

  it("resolves an @name against the members it was given", () => {
    const content = "hello @bob";
    const withBob = groups([message("a", 1, { content })], {
      mentions: mentionTargets([BOB], "u-ada"),
    });
    const withoutBob = groups([message("a", 1, { content })]);
    expect(JSON.stringify(withBob[0]?.bodies[0]?.parts)).toContain("u-bob");
    expect(JSON.stringify(withoutBob[0]?.bodies[0]?.parts)).not.toContain("u-bob");
  });

  it("keeps the day headings", () => {
    expect(present([message("a", 1)]).map((section) => section.day)).toHaveLength(1);
  });
});

describe("memberFaces and mentionTargets", () => {
  it("keep a picture only for members that have one", () => {
    expect([...memberFaces([ADA, BOB])]).toEqual([["u-ada", "/a.png"]]);
  });

  it("key mentions by lower-cased username and flag yourself", () => {
    const targets = mentionTargets([ADA, BOB], "u-bob");
    expect([...targets.keys()]).toEqual(["ada", "bob"]);
    expect(targets.get("ada")).toEqual({
      userId: "u-ada",
      username: "Ada",
      displayName: "Ada L.",
      self: false,
    });
    expect(targets.get("bob")?.self).toBe(true);
  });
});

describe("pinnedRows", () => {
  it("lists one row per pinned message in the given order", () => {
    const rows = pinnedRows(
      [
        message("a", 1, { pinnedAt: at(9), content: "first" }),
        message("b", 2, { pinnedAt: at(8), content: "second" }),
      ],
      "en",
      "Orbit",
    );
    expect(rows).toEqual([
      { id: "a", authorId: "u-ada", authorName: "Ada", preview: "first", timestamp: at(1), pinnedAt: at(9) },
      { id: "b", authorId: "u-ada", authorName: "Ada", preview: "second", timestamp: at(2), pinnedAt: at(8) },
    ]);
  });

  it("skips a message the server did not mark as pinned", () => {
    expect(pinnedRows([message("a", 1)], "en", "Orbit")).toEqual([]);
  });

  it("credits a server notice to the server", () => {
    const [row] = pinnedRows(
      [message("n", 1, { pinnedAt: at(2), author: { id: "system", displayName: "system" } })],
      "en",
      "Orbit",
    );
    expect(row?.authorName).toBe("Orbit");
  });
});
