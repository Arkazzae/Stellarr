import { describe, expect, it } from "vitest";

import type { Attachment, Message, MessageEmbed } from "@/ports";

import { inlineDescendants, isJumbo, parseInline, toParts, type MessagePart } from "./parts";

function message(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    channelId: "c1",
    author: { id: "u1", displayName: "Ada" },
    content: "",
    attachments: [],
    embeds: [],
    createdAt: "2026-03-08T19:07:00.000Z",
    ...overrides,
  };
}

function embed(overrides: Partial<MessageEmbed>): MessageEmbed {
  return {
    id: "e1",
    url: "https://example.org/a",
    kind: "link",
    provider: "example.org",
    domain: "example.org",
    title: "Tytuł",
    ...overrides,
  };
}

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: "a",
    url: "https://cdn/a",
    name: "a.bin",
    contentType: "application/octet-stream",
    size: 10,
    ...overrides,
  };
}

const mentions = new Map([
  ["ada", { userId: "u-ada", username: "ada", displayName: "Ada" }],
]);
const emoji = new Map([["party", "/party.webp"]]);

const kinds = (parts: MessagePart[]) => parts.map((part) => part.kind);

describe("inline text recognisers", () => {
  it("does not read a mention out of a longer word or address", () => {
    expect(parseInline("write to bob@ada now", { mentions })).toEqual([
      { kind: "text", text: "write to bob@ada now" },
    ]);
    expect(parseInline("@ada_ and @adam", { mentions })).toEqual([
      { kind: "text", text: "@ada_ and @adam" },
    ]);
    expect(parseInline("@ada", { mentions })).toMatchObject([{ kind: "mention", username: "ada", self: false }]);
  });

  it("looks up mentions case-insensitively but shows what was typed", () => {
    expect(parseInline("hej @ADA!", { mentions })).toEqual([
      { kind: "text", text: "hej " },
      { kind: "mention", text: "@ADA", userId: "u-ada", username: "ada", displayName: "Ada", self: false },
      { kind: "text", text: "!" },
    ]);
  });

  it("keeps a link's label plain, without mentions or emoji", () => {
    const [link, ...rest] = parseInline("[hej @ada :party:](https://x.test)", { mentions, emoji });

    expect(link).toEqual({ kind: "link", href: "https://x.test", text: "hej @ada :party:" });
    expect(rest).toEqual([]);
  });

  it("resolves a mention and an emoji inside a spoiler", () => {
    const nodes = parseInline("||@ada :party:||", { mentions, emoji });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "spoiler", text: "@ada :party:" });
    expect(inlineDescendants(nodes).map((node) => node.kind)).toEqual([
      "spoiler",
      "mention",
      "text",
      "emoji",
    ]);
  });

  it("leaves characters that look like markup exactly as typed", () => {
    for (const source of ['a < b && c > "d"', "&amp; &lt;", "1 < 2 > 0"]) {
      expect(parseInline(source)).toEqual([{ kind: "text", text: source }]);
    }
    expect(parseInline("`<b>&\"`")).toEqual([{ kind: "code", text: '<b>&"' }]);
  });

  it("starts a new line for a hard break", () => {
    expect(parseInline("raz  \ndwa")).toEqual([{ kind: "text", text: "raz\ndwa" }]);
  });

  it("stays readable when markers pile up without end", () => {
    for (const source of ["[".repeat(3000), "*".repeat(3000), "||".repeat(1500)]) {
      const text = parseInline(source)
        .map((node) => ("text" in node ? node.text : ""))
        .join("");
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe("toParts — text and code", () => {
  it("keeps prose and fenced blocks in the order they were written", () => {
    const parts = toParts(
      message({ content: "przed\n```ts\nconst a = 1;\n```\npo\n```\n{\"a\":1}\n```" }),
    );

    expect(kinds(parts)).toEqual(["text", "code", "text", "code"]);
    expect(parts[1]).toMatchObject({ lang: "ts", language: "typescript", source: "const a = 1;" });
    expect(parts[3]).toMatchObject({ lang: "", language: "json" });
  });

  it("drops the authored name when the block ends up as plain text", () => {
    const [part] = toParts(message({ content: "```text\nnic ciekawego\n```" }));

    expect(part).toMatchObject({ kind: "code", lang: "", language: "plaintext" });
  });

  it("keeps the authored name for an unknown language and guesses from the code", () => {
    const [part] = toParts(message({ content: "```mojo\nSELECT id FROM t\n```" }));

    expect(part).toMatchObject({ kind: "code", lang: "mojo", language: "sql" });
  });

  it("does not format inside a code block", () => {
    const [part] = toParts(message({ content: "```\n**not bold** @ada :party:\n```" }));

    expect(part).toMatchObject({ kind: "code", source: "**not bold** @ada :party:" });
  });

  it("leaves a fence that never closes as ordinary text", () => {
    expect(kinds(toParts(message({ content: "```js\nconst a = 1;" })))).toEqual(["text"]);
  });

  it("passes the system, emoji and mention options to the prose", () => {
    const [part] = toParts(message({ content: "<b>@ada</b> :party:" }), {
      system: true,
      emoji,
      mentions,
    });

    expect(part).toMatchObject({
      kind: "text",
      nodes: [{ kind: "strong", text: "@ada" }, { kind: "text", text: " " }, { kind: "emoji" }],
    });
  });
});

describe("toParts — edit mark", () => {
  it("goes at the end of the last run of prose", () => {
    const parts = toParts(
      message({ content: "pierwsze\n```\ncode\n```\nostatnie", editedAt: "2026-03-09T10:00:00Z" }),
    );

    expect(parts[0]).toMatchObject({ nodes: [{ kind: "text", text: "pierwsze" }] });
    expect(parts[2]).toMatchObject({
      nodes: [
        { kind: "text", text: "ostatnie" },
        { kind: "edited", at: "2026-03-09T10:00:00Z" },
      ],
    });
  });

  it("is left out when there is no prose to carry it", () => {
    const parts = toParts(
      message({
        content: "```\ncode\n```",
        editedAt: "2026-03-09T10:00:00Z",
        attachments: [attachment({ contentType: "image/png" })],
      }),
    );

    expect(kinds(parts)).toEqual(["code", "image"]);
  });

  it("never comes from the text itself", () => {
    const [part] = toParts(message({ content: "(edytowano)" }));

    expect(part).toEqual({ kind: "text", nodes: [{ kind: "text", text: "(edytowano)" }] });
  });
});

describe("toParts — links with their own preview", () => {
  const withEmbed = (content: string) =>
    toParts(message({ content, embeds: [embed({})] })).filter((part) => part.kind === "text");

  it("takes the link out of the middle of a sentence and closes the gap", () => {
    expect(withEmbed("zobacz https://example.org/a teraz")).toEqual([
      { kind: "text", nodes: [{ kind: "text", text: "zobacz teraz" }] },
    ]);
  });

  it("leaves line breaks around a removed link alone", () => {
    expect(withEmbed("pierwsza\nhttps://example.org/a\ndruga")).toEqual([
      { kind: "text", nodes: [{ kind: "text", text: "pierwsza\n\ndruga" }] },
    ]);
  });

  it("keeps links that have no preview", () => {
    const [part] = withEmbed("https://example.org/a https://other.test/b");

    expect(part).toEqual({
      kind: "text",
      nodes: [{ kind: "link", href: "https://other.test/b", text: "https://other.test/b" }],
    });
  });

  it("reaches into formatting and drops what it empties", () => {
    const [inStrong] = withEmbed("**https://example.org/a**");
    expect(inStrong).toBeUndefined();

    const [kept] = withEmbed("**ważne https://example.org/a**");
    expect(kept).toMatchObject({
      nodes: [{ kind: "strong", text: "ważne", children: [{ kind: "text", text: "ważne" }] }],
    });

    expect(withEmbed("||https://example.org/a||")).toEqual([]);
  });

  it("does not touch a link inside a code block", () => {
    const parts = toParts(message({ content: "```\nhttps://example.org/a\n```", embeds: [embed({})] }));

    expect(parts[0]).toMatchObject({ kind: "code", source: "https://example.org/a" });
  });
});

describe("toParts — GIPHY", () => {
  const pageUrl = "https://giphy.com/gifs/reaction-happy-AbCd1234";

  it("shows the GIF alone, without cards, edit mark or prose", () => {
    const parts = toParts(
      message({
        content: ` ${pageUrl} `,
        embeds: [embed({ url: pageUrl, title: "preview" })],
        editedAt: "2026-03-09T10:00:00Z",
      }),
    );

    expect(parts).toEqual([{ kind: "giphy", id: "AbCd1234", pageUrl }]);
  });

  it("still lists the message's attachments after the GIF", () => {
    const parts = toParts(
      message({ content: pageUrl, attachments: [attachment({ name: "a.zip" })] }),
    );

    expect(kinds(parts)).toEqual(["giphy", "file"]);
  });

  it("treats a GIPHY link inside a sentence as an ordinary link", () => {
    expect(kinds(toParts(message({ content: `patrz ${pageUrl}` })))).toEqual(["text"]);
  });
});

describe("toParts — attachments", () => {
  it("starts a new gallery after something that is not an image", () => {
    const image = (id: string) =>
      attachment({ id, name: `${id}.png`, contentType: "image/png", url: `u/${id}` });
    const parts = toParts(
      message({ attachments: [image("a"), attachment({ id: "f" }), image("b"), image("c")] }),
    );

    expect(kinds(parts)).toEqual(["image", "file", "gallery"]);
  });

  it("carries image dimensions only when they are known", () => {
    const [sized] = toParts(
      message({ attachments: [attachment({ contentType: "image/png", width: 3, height: 4 })] }),
    );
    const [bare] = toParts(message({ attachments: [attachment({ contentType: "image/png" })] }));

    expect(sized).toMatchObject({ width: 3, height: 4 });
    expect(bare).not.toHaveProperty("width");
    expect(bare).not.toHaveProperty("height");
  });

  it("formats durations as minutes and zero-padded seconds, never negative", () => {
    const duration = (seconds: number) =>
      toParts(
        message({ attachments: [attachment({ contentType: "audio/ogg", durationSeconds: seconds })] }),
      )[0];

    expect(duration(61.9)).toMatchObject({ duration: "1:01" });
    expect(duration(3600)).toMatchObject({ duration: "60:00" });
    expect(duration(-5)).toMatchObject({ duration: "0:00" });
  });

  it("omits audio and video metadata the server did not measure", () => {
    const [audio, video] = toParts(
      message({
        attachments: [
          attachment({ contentType: "audio/ogg", isVoiceMessage: false }),
          attachment({ contentType: "video/mp4" }),
        ],
      }),
    );

    expect(audio).not.toHaveProperty("duration");
    expect(audio).not.toHaveProperty("voiceMessage");
    expect(video).not.toHaveProperty("thumb");
    expect(video).not.toHaveProperty("duration");
  });
});

describe("isJumbo", () => {
  const text = (source: string): MessagePart[] => [
    { kind: "text", nodes: parseInline(source, { emoji }) },
  ];

  it("is true for up to three emoji, Unicode or custom, in any mix", () => {
    expect(isJumbo(text("🎉"))).toBe(true);
    expect(isJumbo(text(":party: 🎉 :party:"))).toBe(true);
  });

  it("is false for a fourth emoji, for words, and for formatted emoji", () => {
    expect(isJumbo(text(":party: :party: :party: :party:"))).toBe(false);
    expect(isJumbo(text("brawo 🎉"))).toBe(false);
    expect(isJumbo(text("**🎉**"))).toBe(false);
  });

  it("is false unless the body is exactly one run of prose", () => {
    expect(isJumbo([])).toBe(false);
    expect(isJumbo([...text("🎉"), ...text("🎉")])).toBe(false);
    expect(isJumbo([{ kind: "code", lang: "", tokens: [] }])).toBe(false);
    expect(isJumbo([{ kind: "giphy", id: "x", pageUrl: "https://giphy.com/gifs/x" }])).toBe(false);
  });
});
