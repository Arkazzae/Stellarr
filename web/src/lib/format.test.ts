import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/api/types";
import {
  buildThreadTranscript,
  buildTranscript,
  formatBytes,
  formatDay,
  initials,
  messageReference,
} from "./format";

function message(
  id: string,
  authorId: string,
  createdAt: string,
  content = id,
): Message {
  return {
    id,
    channelId: "ch-general",
    author: { id: authorId, displayName: authorId },
    content,
    attachments: [],
    embeds: [],
    createdAt,
  };
}

const NOW = new Date("2026-08-10T21:00:00Z");

describe("buildTranscript", () => {
  it("returns nothing for an empty channel", () => {
    expect(buildTranscript([], NOW)).toEqual([]);
  });

  it("merges consecutive messages from one author inside the 5 minute window", () => {
    const sections = buildTranscript(
      [
        message("a", "ada", "2026-08-10T19:00:00Z"),
        message("b", "ada", "2026-08-10T19:03:00Z"),
        message("c", "ada", "2026-08-10T19:04:30Z"),
      ],
      NOW,
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.groups).toHaveLength(1);
    expect(sections[0]?.groups[0]?.messages.map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("starts a new group once the window lapses", () => {
    const sections = buildTranscript(
      [
        message("a", "ada", "2026-08-10T19:00:00Z"),
        message("b", "ada", "2026-08-10T19:06:00Z"),
      ],
      NOW,
    );

    expect(sections[0]?.groups).toHaveLength(2);
  });

  it("starts a new group when the author changes", () => {
    const sections = buildTranscript(
      [
        message("a", "ada", "2026-08-10T19:00:00Z"),
        message("b", "nils", "2026-08-10T19:00:30Z"),
        message("c", "ada", "2026-08-10T19:01:00Z"),
      ],
      NOW,
    );

    expect(sections[0]?.groups.map((group) => group.authorId)).toEqual([
      "ada",
      "nils",
      "ada",
    ]);
  });

  it("splits sections on a day boundary", () => {
    const sections = buildTranscript(
      [
        message("a", "ada", "2026-08-09T19:00:00Z"),
        message("b", "ada", "2026-08-10T19:00:00Z"),
      ],
      NOW,
    );

    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.day)).toEqual(["Wczoraj", "Dziś"]);
  });
});

describe("messageReference", () => {
  it("quotes the words, on one line", () => {
    const answered = message("a", "ada", "2026-08-10T19:00:00Z", "no to\n  jedziemy");
    expect(messageReference(answered)).toEqual({
      id: "a",
      authorId: "ada",
      authorName: "ada",
      preview: "no to jedziemy",
    });
  });

  it("says what a wordless attachment is instead of quoting nothing", () => {
    const answered: Message = {
      ...message("a", "ada", "2026-08-10T19:00:00Z", ""),
      attachments: [
        {
          id: "att-1",
          url: "/u/a.png",
          name: "a.png",
          contentType: "image/png",
          size: 1024,
        },
      ],
    };
    expect(messageReference(answered)).toMatchObject({
      preview: "Kliknij, aby zobaczyć załącznik",
      hasAttachment: true,
    });
  });
});

describe("formatDay", () => {
  it("names today and yesterday rather than printing a date", () => {
    expect(formatDay("2026-08-10T10:00:00Z", NOW)).toBe("Dziś");
    expect(formatDay("2026-08-09T10:00:00Z", NOW)).toBe("Wczoraj");
  });

  it("survives an unparseable timestamp", () => {
    expect(formatDay("not-a-date", NOW)).toBe("");
  });
});

describe("buildTranscript and replies", () => {
  it("starts a new block for a reply, even mid-conversation", () => {
    const answer: Message = {
      ...message("b", "ada", "2026-08-10T19:01:00Z"),
      replyTo: {
        id: "a",
        authorId: "nils",
        authorName: "Nils",
        preview: "pytanie",
      },
    };
    const sections = buildTranscript(
      [message("a", "ada", "2026-08-10T19:00:00Z"), answer],
      NOW,
    );

    expect(sections[0]?.groups).toHaveLength(2);
    expect(sections[0]?.groups[1]?.messages[0]?.replyTo?.authorName).toBe("Nils");
  });

  it("does not make a later channel message look like part of the reply", () => {
    const answer: Message = {
      ...message("answer", "ada", "2026-08-10T19:01:00Z"),
      replyTo: {
        id: "root",
        authorId: "nils",
        authorName: "Nils",
        preview: "pytanie",
      },
    };
    const sections = buildTranscript(
      [answer, message("channel", "ada", "2026-08-10T19:02:00Z")],
      NOW,
    );

    expect(sections[0]?.groups).toHaveLength(2);
    expect(sections[0]?.groups[1]?.messages[0]?.id).toBe("channel");
    expect(sections[0]?.groups[1]?.messages[0]?.replyTo).toBeUndefined();
  });

  it("builds a thread from the root and its exact replies as a normal discussion", () => {
    const root = message("root", "ada", "2026-08-10T19:00:00Z");
    const reply = (id: string, at: string): Message => ({
      ...message(id, "ada", at),
      replyTo: {
        id: root.id,
        authorId: root.author.id,
        authorName: root.author.displayName,
        preview: root.content,
      },
    });
    const sections = buildThreadTranscript(
      [
        root,
        reply("reply-1", "2026-08-10T19:01:00Z"),
        message("ordinary-channel-message", "ada", "2026-08-10T19:02:00Z"),
        reply("reply-2", "2026-08-10T19:03:00Z"),
      ],
      root.id,
      NOW,
    );

    expect(sections[0]?.groups).toHaveLength(2);
    expect(sections[0]?.groups[0]?.messages.map(({ id }) => id)).toEqual(["root"]);
    expect(sections[0]?.groups[1]?.messages.map(({ id }) => id)).toEqual([
      "reply-1",
      "reply-2",
    ]);
    expect(sections[0]?.groups[1]?.messages[0]?.replyTo).toBeUndefined();
  });
});

describe("initials", () => {
  it("takes one letter per word, or two from a single word", () => {
    expect(initials("Ada")).toBe("AD");
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  ")).toBe("?");
  });
});

describe("formatBytes", () => {
  it("scales the unit to the size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });
});
