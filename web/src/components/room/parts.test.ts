import { describe, expect, it } from "vitest";

import type { Attachment, Message } from "@/ports";

import { fileExt, isJumbo, parseInline, toParts } from "./parts";

describe("parseInline", () => {
  it("recognizes Markdown emphasis, strong emphasis and strikethrough", () => {
    const nodes = parseInline("Ocena **6/10**, *kursywa*, __grubo__, _lekko_ i ~~stare~~.");
    expect(nodes.filter(n => n.kind !== "text").map(n => [n.kind, "text" in n ? n.text : ""]))
      .toEqual([["strong", "6/10"], ["emphasis", "kursywa"], ["strong", "grubo"], ["emphasis", "lekko"], ["strike", "stare"]]);
  });

  it("recognizes ||spoilers|| with formatting inside, and leaves lone pipes alone", () => {
    const [spoiler, rest] = parseInline("||**zakończenie** filmu|| a || nie");
    expect(spoiler).toMatchObject({ kind: "spoiler", text: "zakończenie filmu" });
    expect(spoiler && "children" in spoiler ? spoiler.children?.[0] : null).toMatchObject({ kind: "strong", text: "zakończenie" });
    expect(rest).toEqual({ kind: "text", text: " a || nie" });
    expect(parseInline("a || b")).toEqual([{ kind: "text", text: "a || b" }]);
  });

  it("keeps escaped markers and code literal without changing snake_case names", () => {
    expect(parseInline("\\*literal\\* foo_bar_baz `**raw** @ada`"))
      .toEqual([{ kind: "text", text: "*literal* foo_bar_baz " }, { kind: "code", text: "**raw** @ada" }]);
    expect(parseInline("**niedomknięte")).toEqual([{ kind: "text", text: "**niedomknięte" }]);
  });

  it("keeps mention identity and emoji inside nested formatting", () => {
    const nodes = parseInline("**@ada *ważne* `kod` :party:**", {
      mentions: new Map([["ada", { userId: "ada-id", username: "ada", displayName: "Ada", self: true }]]),
      emoji: new Map([["party", "/party.webp"]]),
    });
    expect(nodes[0]).toMatchObject({ kind: "strong", children: [
      { kind: "mention", userId: "ada-id", self: true }, { kind: "text", text: " " },
      { kind: "emphasis", text: "ważne" }, { kind: "text", text: " " },
      { kind: "code", text: "kod" }, { kind: "text", text: " " },
      { kind: "emoji", shortcode: "party" },
    ] });
  });

  it("allows Markdown http links but never injects HTML or loads Markdown images", () => {
    expect(parseInline("[strona](https://example.com)")[0])
      .toEqual({ kind: "link", text: "strona", href: "https://example.com" });
    for (const source of ["[klik](javascript:alert(1))", "[klik](data:text/html,x)", "![obraz](https://tracker.test/a.png)"])
      expect(parseInline(source)).toEqual([{ kind: "text", text: source }]);
  });
  it("keeps markup the sender typed as literal text", () => {
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([
      { kind: "text", text: '<img src=x onerror="alert(1)">' },
    ]);
  });

  it("recognises inline code", () => {
    expect(parseInline("nowy <code>VoiceClient</code> działa")).toEqual([
      { kind: "text", text: "nowy " },
      { kind: "code", text: "VoiceClient" },
      { kind: "text", text: " działa" },
    ]);
  });

  it("allows <b> only in system notices", () => {
    const content = "<b>Jo</b> dołącza do serwera.";
    expect(parseInline(content, { strong: true })[0]).toEqual({
      kind: "strong",
      text: "Jo",
    });
    expect(parseInline(content)).toEqual([{ kind: "text", text: content }]);
  });

  it("autolinks http(s) and nothing else", () => {
    expect(parseInline("zobacz https://example.com/a#b tutaj")).toEqual([
      { kind: "text", text: "zobacz " },
      { kind: "link", href: "https://example.com/a#b", text: "https://example.com/a#b" },
      { kind: "text", text: " tutaj" },
    ]);
    expect(parseInline("javascript:alert(1)")).toEqual([
      { kind: "text", text: "javascript:alert(1)" },
    ]);
  });

  it("leaves sentence punctuation out of the link", () => {
    const [link, tail] = parseInline("patrz https://example.com/a.");
    expect(link).toEqual({ kind: "text", text: "patrz " });
    expect(tail).toEqual({
      kind: "link",
      href: "https://example.com/a",
      text: "https://example.com/a",
    });
    expect(parseInline("(https://example.com/a)")[1]).toMatchObject({
      href: "https://example.com/a",
    });
    expect(parseInline("https://example.com/a_(b)")[0]).toMatchObject({
      href: "https://example.com/a_(b)",
    });
  });

  it("does not treat a code tag inside bold as markup", () => {
    expect(parseInline("<b><code>x</code></b>", { strong: true })).toEqual([
      { kind: "strong", text: "<code>x</code>" },
    ]);
  });

  it("resolves real member mentions outside code and links", () => {
    const mentions = new Map([
      ["ada", { userId: "user-ada", username: "ada", displayName: "Ada", self: true }],
    ]);
    expect(parseInline("Hej @Ada, `@ada` i https://x.test/@ada oraz @nikt", { mentions }))
      .toEqual([
        { kind: "text", text: "Hej " },
        {
          kind: "mention",
          text: "@Ada",
          userId: "user-ada",
          username: "ada",
          displayName: "Ada",
          self: true,
        },
        { kind: "text", text: ", " },
        { kind: "code", text: "@ada" },
        { kind: "text", text: " i " },
        { kind: "link", href: "https://x.test/@ada", text: "https://x.test/@ada" },
        { kind: "text", text: " oraz @nikt" },
      ]);
  });
});

describe("fileExt", () => {
  it("uppercases and clips to four characters", () => {
    expect(fileExt("raport.pdf")).toBe("PDF");
    expect(fileExt("dane.sqlite")).toBe("SQLI");
  });

  it("falls back when there is no extension", () => {
    expect(fileExt("README")).toBe("PLIK");
    expect(fileExt("README", "?")).toBe("?");
  });
});

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: "a",
    url: "https://cdn/a",
    name: "a.bin",
    contentType: "application/octet-stream",
    size: 1024,
    ...overrides,
  };
}

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

describe("toParts — unfurled links", () => {
  const embed = (overrides: Partial<Message["embeds"][number]>) => ({
    id: "e1",
    url: "https://example.org/a",
    kind: "link" as const,
    provider: "example.org",
    domain: "example.org",
    ...overrides,
  });

  it("renders a card between the prose and the files", () => {
    const parts = toParts(
      message({
        content: "patrz",
        embeds: [embed({ title: "Tytuł", description: "Opis", thumbnailUrl: "/assets/1" })],
      }),
    );
    expect(parts[0]?.kind).toBe("text");
    expect(parts[1]).toEqual({
      kind: "embed",
      domain: "example.org",
      title: "Tytuł",
      description: "Opis",
      url: "https://example.org/a",
      thumb: "/assets/1",
    });
  });

  it("replaces a previewed URL in the rendered prose with its card", () => {
    const parts = toParts(
      message({
        content: "polecam: https://example.org/a",
        embeds: [embed({ title: "Tytuł" })],
      }),
    );

    expect(parts[0]).toEqual({
      kind: "text",
      nodes: [{ kind: "text", text: "polecam:" }],
    });
    expect(parts[1]?.kind).toBe("embed");
  });

  it("renders only the player when the message contains only its URL", () => {
    const parts = toParts(
      message({
        content: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        embeds: [
          embed({
            url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            kind: "video",
            provider: "youtube",
            providerId: "aqz-KE-bpKQ",
            domain: "youtube.com",
            title: "Bunny",
          }),
        ],
      }),
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]?.kind).toBe("video-embed");
  });

  it("keeps the URL when the server did not produce a useful preview", () => {
    const parts = toParts(
      message({
        content: "https://example.org/a",
        embeds: [embed({})],
      }),
    );

    expect(parts).toEqual([
      {
        kind: "text",
        nodes: [
          {
            kind: "link",
            href: "https://example.org/a",
            text: "https://example.org/a",
          },
        ],
      },
    ]);
  });

  it("drops a card that says nothing the link did not", () => {
    expect(toParts(message({ embeds: [embed({})] }))).toEqual([]);
  });

  it("falls back to the domain as a title when there is a picture", () => {
    const parts = toParts(message({ embeds: [embed({ thumbnailUrl: "/assets/1" })] }));
    expect(parts[0]).toMatchObject({ kind: "embed", title: "example.org" });
  });

  it("turns a video embed into a player, timestamp and all", () => {
    const parts = toParts(
      message({
        embeds: [
          embed({
            kind: "video",
            provider: "youtube",
            providerId: "aqz-KE-bpKQ",
            startSeconds: 95,
            domain: "youtube.com",
            title: "Bunny",
          }),
        ],
      }),
    );
    expect(parts[0]).toEqual({
      kind: "video-embed",
      provider: "youtube",
      providerId: "aqz-KE-bpKQ",
      url: "https://example.org/a",
      domain: "youtube.com",
      title: "Bunny",
      startSeconds: 95,
    });
  });

  it("treats a video embed with no id as an ordinary card", () => {
    const parts = toParts(
      message({ embeds: [embed({ kind: "video", provider: "youtube", title: "X" })] }),
    );
    expect(parts[0]?.kind).toBe("embed");
  });

  it("keeps several links in the order the server sent them", () => {
    const parts = toParts(
      message({
        embeds: [
          embed({ id: "a", title: "Pierwszy" }),
          embed({ id: "b", title: "Drugi" }),
        ],
      }),
    );
    expect(parts.map((part) => (part.kind === "embed" ? part.title : null))).toEqual([
      "Pierwszy",
      "Drugi",
    ]);
  });
});

describe("toParts", () => {
  it("puts the text body first", () => {
    expect(toParts(message({ content: "  cześć  " }))).toEqual([
      { kind: "text", nodes: [{ kind: "text", text: "cześć" }] },
    ]);
    expect(toParts(message({ content: "   " }))).toEqual([]);
  });

  it("keeps fenced source and resolves highlighting from a filename", () => {
    const source = "# komentarz\ndef greet():\n    return 'hej'";
    const [part] = toParts(message({
      content: `\`\`\`worker.py\n${source}\n\`\`\``,
    }));

    expect(part).toMatchObject({
      kind: "code",
      lang: "worker.py",
      source,
      language: "python",
    });
    if (part?.kind !== "code") throw new Error("expected code part");
    expect(part.tokens.map((token) => token.text).join("")).toBe(source);
  });

  it("keeps an unfenced multiline editor paste as ordinary text", () => {
    const source = "const room = createRoom();\nroom.join();\nroom.connect();";
    const [part] = toParts(message({ content: source }));

    expect(part).toMatchObject({ kind: "text" });
  });

  it("keeps multiline prose as ordinary text", () => {
    const content = "Pierwsze zdanie.\nDrugie zdanie.\nTrzecie zdanie.";
    expect(toParts(message({ content }))[0]).toMatchObject({ kind: "text" });
  });

  it("keeps an overlong message as text for the disclosure renderer", () => {
    const content = "zwykła długa wiadomość ".repeat(180);
    expect(toParts(message({ content }))[0]).toMatchObject({ kind: "text" });
  });

  it("turns a canonical GIPHY page into a live GIF part", () => {
    const pageUrl = "https://giphy.com/gifs/reaction-happy-AbCd1234";
    expect(
      toParts(
        message({
          content: pageUrl,
          embeds: [
            {
              id: "giphy-preview",
              url: pageUrl,
              kind: "link",
              provider: "giphy.com",
              domain: "giphy.com",
              title: "A cached preview that must not render",
            },
          ],
        }),
      ),
    ).toEqual([{ kind: "giphy", id: "AbCd1234", pageUrl }]);
  });

  it("collapses consecutive images into a gallery but keeps a lone one", () => {
    const image = (id: string) =>
      attachment({ id, name: `${id}.png`, contentType: "image/png", url: `u/${id}` });

    expect(toParts(message({ attachments: [image("x")] }))).toEqual([
      { kind: "image", src: "u/x", alt: "x.png" },
    ]);

    const parts = toParts(
      message({ attachments: [image("x"), image("y"), attachment({ id: "z" })] }),
    );
    expect(parts[0]).toEqual({
      kind: "gallery",
      images: [
        { src: "u/x", alt: "x.png" },
        { src: "u/y", alt: "y.png" },
      ],
    });
    expect(parts[1]).toMatchObject({ kind: "file", ext: "BIN" });
  });

  it("formats a file's size and uses measured media metadata", () => {
    const parts = toParts(
      message({
        attachments: [
          attachment({ name: "logs.zip", contentType: "application/zip", size: 8_800_000 }),
          attachment({
            id: "b",
            name: "vm.ogg",
            contentType: "audio/ogg",
            durationSeconds: 19.9,
            isVoiceMessage: true,
          }),
          attachment({
            id: "c",
            name: "clip.mp4",
            contentType: "video/mp4",
            width: 400,
            height: 225,
            durationSeconds: 42.125,
            posterUrl: "/assets/c/poster",
          }),
        ],
      }),
    );
    expect(parts[0]).toEqual({
      kind: "file",
      name: "logs.zip",
      ext: "ZIP",
      size: "8.4 MB",
      url: "https://cdn/a",
    });
    expect(parts[1]).toMatchObject({
      kind: "audio",
      name: "vm.ogg",
      duration: "0:19",
      voiceMessage: true,
    });
    expect(parts[2]).toMatchObject({
      kind: "video",
      width: 400,
      height: 225,
      duration: "0:42",
      thumb: "/assets/c/poster",
    });
  });

  it("only honours <b> when the caller says the message is a system notice", () => {
    const notice = message({ content: "<b>Jo</b> dołącza" });
    expect(toParts(notice, { system: true })[0]).toMatchObject({
      nodes: [{ kind: "strong", text: "Jo" }, { kind: "text", text: " dołącza" }],
    });
    expect(toParts(notice)[0]).toMatchObject({
      nodes: [{ kind: "text", text: "<b>Jo</b> dołącza" }],
    });
  });
});

describe("custom emoji and jumbo bodies", () => {
  const emoji = new Map([["mushris", "https://cdn.example/mushris.png"]]);

  it("renders a known shortcode as the server's picture", () => {
    const nodes = parseInline("hej :mushris: no", { emoji });

    expect(nodes).toEqual([
      { kind: "text", text: "hej " },
      { kind: "emoji", shortcode: "mushris", src: "https://cdn.example/mushris.png" },
      { kind: "text", text: " no" },
    ]);
  });

  it("leaves an unknown shortcode as the text somebody typed", () => {
    // The map is the allow-list: a sender cannot name a picture the server
    // does not have, and `18:30 :` must never start a search for an emoji.
    expect(parseInline("o :nieistnieje: i 18:30", { emoji })).toEqual([
      { kind: "text", text: "o :nieistnieje: i 18:30" },
    ]);
  });

  it("does not pull a shortcode out of code or a link", () => {
    expect(parseInline("`:mushris:`", { emoji })).toEqual([
      { kind: "code", text: ":mushris:" },
    ]);

    const linked = parseInline("https://x.test/:mushris:/a", { emoji });
    expect(linked).toEqual([
      {
        kind: "link",
        href: "https://x.test/:mushris:/a",
        text: "https://x.test/:mushris:/a",
      },
    ]);
  });

  it("draws a short all-emoji message large, and a sentence normally", () => {
    const big = [{ kind: "text" as const, nodes: parseInline("🎉🎉") }];
    expect(isJumbo(big)).toBe(true);

    // A flag and a thumb with a skin tone are one emoji each, not five code
    // points each — `Intl.Segmenter` counts what a reader counts.
    expect(isJumbo([{ kind: "text", nodes: parseInline("🇵🇱 👍🏽") }])).toBe(true);

    expect(isJumbo([{ kind: "text", nodes: parseInline("😀😀😀😀") }])).toBe(false);
    expect(isJumbo([{ kind: "text", nodes: parseInline("no 😀") }])).toBe(false);
    expect(isJumbo([{ kind: "text", nodes: parseInline("!!!") }])).toBe(false);
  });

  it("counts a custom emoji as one, the same as a Unicode one", () => {
    const nodes = parseInline(":mushris: :mushris:", { emoji });
    expect(isJumbo([{ kind: "text", nodes }])).toBe(true);
  });
});
