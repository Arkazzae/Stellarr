import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/api/types";

import {
  buildTranscript,
  formatAgo,
  formatDate,
  formatDay,
  formatTime,
  messageReference,
  toChannelSlug,
} from "./format";

const NOW = new Date(2026, 7, 10, 21, 0, 0);

function secondsBefore(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatAgo", () => {
  it.each<[number, string]>([
    [5, "przed chwilą"],
    [1 * MINUTE, "1 minutę temu"],
    [2 * MINUTE, "2 minuty temu"],
    [5 * MINUTE, "5 minut temu"],
    [12 * MINUTE, "12 minut temu"],
    [22 * MINUTE, "22 minuty temu"],
    [1 * HOUR, "1 godzinę temu"],
    [3 * HOUR, "3 godziny temu"],
    [13 * HOUR, "13 godzin temu"],
    [1 * DAY + HOUR, "wczoraj"],
    [6 * DAY, "6 dni temu"],
  ])("says %i seconds in Polish as %s", (seconds, expected) => {
    expect(formatAgo(secondsBefore(seconds), NOW, "pl")).toBe(expected);
  });

  it.each<[number, string]>([
    [5, "just now"],
    [1 * MINUTE, "1 minute ago"],
    [5 * MINUTE, "5 minutes ago"],
    [1 * HOUR, "1 hour ago"],
    [3 * HOUR, "3 hours ago"],
    [1 * DAY + HOUR, "yesterday"],
    [6 * DAY, "6 days ago"],
  ])("says %i seconds in English as %s", (seconds, expected) => {
    expect(formatAgo(secondsBefore(seconds), NOW, "en")).toBe(expected);
  });

  it("falls back to the calendar date after a month", () => {
    const old = new Date(2026, 5, 1, 12, 0, 0).toISOString();
    expect(formatAgo(old, NOW, "pl")).toBe(formatDate(old, "pl"));
    expect(formatAgo(old, NOW, "en")).toBe(formatDate(old, "en"));
  });

  it("treats a timestamp from the future as just now", () => {
    expect(formatAgo(secondsBefore(-90), NOW, "pl")).toBe("przed chwilą");
  });

  it("survives an unparseable timestamp", () => {
    expect(formatAgo("nope", NOW, "pl")).toBe("");
  });
});

describe("formatTime and formatDate", () => {
  const local = new Date(2025, 2, 12, 9, 5).toISOString();

  it("prints a 24 hour clock in the reader's time zone", () => {
    expect(formatTime(local, "pl")).toBe("09:05");
    expect(formatTime(local, "en")).toBe("09:05");
  });

  it("spells the month out in the language of the interface", () => {
    expect(formatDate(local, "pl")).toBe("12 marca 2025");
    expect(formatDate(local, "en")).toBe("12 March 2025");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatTime("nope", "pl")).toBe("");
    expect(formatDate("nope", "pl")).toBe("");
  });
});

describe("day headings in English", () => {
  it("names today and yesterday", () => {
    expect(formatDay(NOW.toISOString(), NOW, "en")).toBe("Today");
    expect(formatDay(secondsBefore(DAY), NOW, "en")).toBe("Yesterday");
  });

  it("labels the sections of a transcript with them", () => {
    const sections = buildTranscript(
      [
        message("a", secondsBefore(DAY)),
        message("b", NOW.toISOString()),
      ],
      NOW,
      "en",
    );
    expect(sections.map((section) => section.day)).toEqual(["Yesterday", "Today"]);
  });
});

describe("messageReference", () => {
  it("shortens a long message to one line ending in an ellipsis", () => {
    const reference = messageReference(message("a", NOW.toISOString(), "x".repeat(300)));
    expect(reference.preview).toHaveLength(140);
    expect(reference.preview.endsWith("…")).toBe(true);
  });

  it("quotes words in preference to describing the attachment", () => {
    const answered: Message = {
      ...message("a", NOW.toISOString(), "zobacz"),
      attachments: [
        { id: "att", url: "/u/a.png", name: "a.png", contentType: "image/png", size: 1 },
      ],
    };
    expect(messageReference(answered)).toMatchObject({
      preview: "zobacz",
      hasAttachment: true,
    });
  });

  it("describes a wordless attachment in English", () => {
    const answered: Message = {
      ...message("a", NOW.toISOString(), ""),
      attachments: [
        { id: "att", url: "/u/a.png", name: "a.png", contentType: "image/png", size: 1 },
      ],
    };
    expect(messageReference(answered, "en").preview).toBe(
      "Open to view the attachment",
    );
  });

  it("leaves hasAttachment out when there is none", () => {
    expect(messageReference(message("a", NOW.toISOString()))).not.toHaveProperty(
      "hasAttachment",
    );
  });
});

describe("toChannelSlug", () => {
  it.each<[string, string]>([
    ["Ogólny Czat", "ogólny-czat"],
    ["  spaced   out  ", "-spaced-out-"],
    ["a - b", "a-b"],
    ["fun!? #times", "fun-times"],
    ["żółć", "żółć"],
  ])("turns %j into %j", (typed, slug) => {
    expect(toChannelSlug(typed)).toBe(slug);
  });
});

function message(id: string, createdAt: string, content = id): Message {
  return {
    id,
    channelId: "ch-general",
    author: { id: "ada", displayName: "Ada" },
    content,
    attachments: [],
    embeds: [],
    createdAt,
  };
}
