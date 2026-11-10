import { describe, expect, it } from "vitest";

import { formatAgo, formatDay, messageReference, pluralForm } from "./format";

const NOW = new Date("2026-08-10T12:00:00Z");
const MINUTE = 60;
const HOUR = 60 * MINUTE;

function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe("pluralForm", () => {
  it("picks the Polish form by the last digits", () => {
    expect([1, 2, 4, 5, 12, 14, 22, 25].map((n) => pluralForm("pl", n))).toEqual([
      "one",
      "few",
      "few",
      "many",
      "many",
      "many",
      "few",
      "many",
    ]);
  });

  it("knows only one and many in English", () => {
    expect([1, 2, 5, 22].map((n) => pluralForm("en", n))).toEqual(["one", "many", "many", "many"]);
  });
});

describe("relative times in each language", () => {
  it("declines the Polish noun with the count", () => {
    expect(formatAgo(ago(MINUTE), NOW, "pl")).toBe("1 minutę temu");
    expect(formatAgo(ago(22 * MINUTE), NOW, "pl")).toBe("22 minuty temu");
    expect(formatAgo(ago(12 * MINUTE), NOW, "pl")).toBe("12 minut temu");
    expect(formatAgo(ago(3 * HOUR), NOW, "pl")).toBe("3 godziny temu");
  });

  it("uses singular and plural in English", () => {
    expect(formatAgo(ago(5), NOW, "en")).toBe("just now");
    expect(formatAgo(ago(MINUTE), NOW, "en")).toBe("1 minute ago");
    expect(formatAgo(ago(6 * MINUTE), NOW, "en")).toBe("6 minutes ago");
    expect(formatAgo(ago(HOUR), NOW, "en")).toBe("1 hour ago");
    expect(formatAgo(ago(24 * HOUR), NOW, "en")).toBe("yesterday");
    expect(formatAgo(ago(5 * 24 * HOUR), NOW, "en")).toBe("5 days ago");
  });

  it("names the day in each language", () => {
    expect(formatDay(ago(HOUR), NOW, "en")).toBe("Today");
    expect(formatDay(ago(HOUR), NOW, "pl")).toBe("Dziś");
    expect(formatDay(ago(24 * HOUR), NOW, "en")).toBe("Yesterday");
    expect(formatDay(ago(24 * HOUR), NOW, "pl")).toBe("Wczoraj");
  });

  it("follows the page's language when no locale is passed", () => {
    document.documentElement.lang = "en";
    expect(formatDay(ago(HOUR), NOW)).toBe("Today");

    document.documentElement.lang = "pl";
    expect(formatDay(ago(HOUR), NOW)).toBe("Dziś");
  });
});

describe("the line quoted above a reply to an attachment", () => {
  const message = {
    id: "m1",
    channelId: "c1",
    author: { id: "u1", displayName: "Ada" },
    content: "",
    attachments: [{ id: "a1", url: "/a", name: "a.png", contentType: "image/png", size: 1 }],
    embeds: [],
    createdAt: "2026-08-10T10:00:00Z",
  };

  it("says what it is in the reader's language", () => {
    expect(messageReference(message, "en").preview).toBe("Open to view the attachment");
    expect(messageReference(message, "pl").preview).toBe("Kliknij, aby zobaczyć załącznik");
  });
});
