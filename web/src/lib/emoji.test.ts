import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMOJI,
  EMOJI_CATEGORIES,
  foldQuery,
  pushRecentEmoji,
  readRecentEmoji,
  searchEmoji,
  type EmojiEntry,
} from "./emoji";

/** Terms end with the shortcode, as the built-in index builds them. */
function entry(shortcode: string, keywords: string): EmojiEntry {
  const terms = `${keywords} ${shortcode.replaceAll("_", " ")}`;
  return { glyph: shortcode, shortcode, category: "smileys", terms };
}

describe("the built-in set", () => {
  it("gives every emoji its own shortcode, because recents are keyed by it", () => {
    const codes = EMOJI.map((item) => item.shortcode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("lists each table's category on the rail, in table order", () => {
    const railed = EMOJI_CATEGORIES.map((category) => category.id);
    const used = [...new Set(EMOJI.map((item) => item.category))];
    expect(railed.filter((id) => used.includes(id))).toEqual(used);
  });

  it("makes the shortcode searchable with underscores read as spaces", () => {
    const thumb = EMOJI.find((item) => item.shortcode === "kciuk_w_gore");
    expect(thumb?.terms).toContain("kciuk w gore");
  });
});

describe("foldQuery", () => {
  it("drops case, surrounding colons and diacritics", () => {
    expect(foldQuery("  :ŻABA: ")).toBe("zaba");
    expect(foldQuery("Zażółć gęślą")).toBe("zazolc gesla");
  });

  it("keeps colons inside the query", () => {
    expect(foldQuery("a:b")).toBe("a:b");
  });
});

describe("searchEmoji", () => {
  const pool = [
    entry("zielony_kot", "zielony kot green cat"),
    entry("kotek", "kot kociak cat"),
    entry("kot", "zwierze"),
    entry("skot", "bydlo"),
    entry("kot_dwa", "kot dwa"),
  ];

  it("returns nothing for an empty or colon-only query", () => {
    expect(searchEmoji(pool, "")).toEqual([]);
    expect(searchEmoji(pool, " :: ")).toEqual([]);
  });

  it("ranks the exact shortcode, then a prefix, then a word start, then a substring", () => {
    const found = searchEmoji(pool, "kot").map((item) => item.shortcode);
    expect(found).toEqual(["kot", "kotek", "kot_dwa", "zielony_kot", "skot"]);
  });

  it("keeps the source order among equally ranked matches", () => {
    const same = [entry("b", "ala"), entry("a", "ala"), entry("c", "ala")];
    expect(searchEmoji(same, "ala").map((item) => item.shortcode)).toEqual(["b", "a", "c"]);
  });

  it("matches without diacritics, case or colons", () => {
    expect(searchEmoji(EMOJI, "Żaba")[0]?.glyph).toBe("🐸");
    expect(searchEmoji(EMOJI, ":zaba:")[0]?.glyph).toBe("🐸");
  });

  it("finds an emoji by the English alias as well", () => {
    expect(searchEmoji(EMOJI, "wink").map((item) => item.shortcode)).toContain("oczko");
  });

  it("stops at the limit", () => {
    expect(searchEmoji(pool, "k", 2)).toHaveLength(2);
    expect(searchEmoji(EMOJI, "a").length).toBeLessThanOrEqual(120);
  });
});

describe("recent emoji", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts empty", () => {
    expect(readRecentEmoji()).toEqual([]);
  });

  it("keeps the newest first and does not repeat a shortcode", () => {
    pushRecentEmoji("zaba");
    pushRecentEmoji("oczko");
    expect(pushRecentEmoji("zaba")).toEqual(["zaba", "oczko"]);
    expect(readRecentEmoji()).toEqual(["zaba", "oczko"]);
  });

  it("remembers at most 32, dropping the oldest", () => {
    for (let index = 0; index < 40; index += 1) pushRecentEmoji(`code_${index}`);
    const recent = readRecentEmoji();
    expect(recent).toHaveLength(32);
    expect(recent[0]).toBe("code_39");
    expect(recent.at(-1)).toBe("code_8");
  });

  it("treats unreadable storage as no recents", () => {
    localStorage.setItem("stellarr.emoji.recent", "{not json");
    expect(readRecentEmoji()).toEqual([]);
    localStorage.setItem("stellarr.emoji.recent", JSON.stringify({ zaba: true }));
    expect(readRecentEmoji()).toEqual([]);
  });

  it("ignores entries that are not shortcodes", () => {
    localStorage.setItem("stellarr.emoji.recent", JSON.stringify(["zaba", 7, null, "oczko"]));
    expect(readRecentEmoji()).toEqual(["zaba", "oczko"]);
  });

  it("still returns the new list when the device refuses to store it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(pushRecentEmoji("zaba")).toEqual(["zaba"]);
  });
});
