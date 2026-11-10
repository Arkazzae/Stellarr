import { describe, expect, it } from "vitest";

import { collectIndexedPanelItems, collectPanelItems } from "./channelPanelModel";
import type { MessagePart } from "./parts";
import type { TranscriptSectionVM } from "./transcriptRows";

function sectionsOf(...parts: MessagePart[][]): TranscriptSectionVM[] {
  return [
    {
      day: "Dziś",
      groups: parts.map((bodyParts, i) => ({
        id: `g${i}`,
        authorId: "u-ada",
        authorName: "Ada",
        timestamp: `2026-08-13T1${i}:00:00Z`,
        bodies: [{ id: `g${i}`, parts: bodyParts }],
      })),
    },
  ];
}

describe("collectPanelItems links", () => {
  it("lists a video embed as a link and names it by its URL when it has no title", () => {
    const { links } = collectPanelItems(
      sectionsOf([
        {
          kind: "video-embed",
          provider: "youtube",
          providerId: "x",
          url: "https://youtu.be/x",
          domain: "youtube.com",
        },
      ]),
    );

    expect(links).toEqual([
      {
        id: "g0:0",
        href: "https://youtu.be/x",
        title: "https://youtu.be/x",
        domain: "youtube.com",
        authorName: "Ada",
        timestamp: "2026-08-13T10:00:00Z",
      },
    ]);
  });

  it("skips a card that links nowhere", () => {
    const { links } = collectPanelItems(
      sectionsOf(
        [{ kind: "embed", domain: "a.dev", title: "A", description: "" }],
        [{ kind: "embed", domain: "b.dev", title: "B", description: "", url: "" }],
      ),
    );

    expect(links).toEqual([]);
  });

  it("falls back to the raw text for a domain it cannot parse", () => {
    const { links } = collectPanelItems(
      sectionsOf([
        { kind: "text", nodes: [{ kind: "link", href: "not a url", text: "x" }] },
      ]),
    );

    expect(links[0]).toMatchObject({ href: "not a url", domain: "not a url" });
  });

  it("keeps a repeated link at its newest posting even when it was a card before", () => {
    const { links } = collectPanelItems(
      sectionsOf(
        [{ kind: "embed", domain: "orbit.dev", title: "Orbit", description: "", url: "https://orbit.dev/x" }],
        [{ kind: "text", nodes: [{ kind: "link", href: "https://orbit.dev/x", text: "x" }] }],
      ),
    );

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: "g1:0:0", title: "https://orbit.dev/x" });
  });
});

describe("collectPanelItems media", () => {
  it("puts each kind of upload on the media list with the part intact", () => {
    const video: MessagePart = { kind: "video", duration: "0:09", url: "/v.mp4" };
    const audio: MessagePart = { kind: "audio", name: "a.ogg", voiceMessage: true };
    const { media } = collectPanelItems(sectionsOf([video, audio]));

    expect(media.map((item) => item.part)).toEqual([audio, video]);
    expect(media.map((item) => item.id)).toEqual(["g0:1", "g0:0"]);
  });

  it("numbers the pictures of a gallery so each has an id of its own", () => {
    const { media } = collectPanelItems(
      sectionsOf([
        { kind: "gallery", images: [{ src: "/1.png", alt: "" }, { src: "/2.png", alt: "" }] },
      ]),
    );

    expect(media.map((item) => item.id)).toEqual(["g0:0:0", "g0:0:1"]);
  });
});

describe("collectIndexedPanelItems", () => {
  const message = (id: string, authorId: string, createdAt: string, content: string) => ({
    id,
    channelId: "c1",
    author: { id: authorId, displayName: authorId },
    content,
    createdAt,
    attachments: [],
    embeds: [],
  });

  it("leaves server notices out", () => {
    const data = collectIndexedPanelItems([
      message("m1", "system", "2026-08-01T10:00:00Z", "https://example.com/rules"),
      message("m2", "u1", "2026-08-01T11:00:00Z", "https://example.com/talk"),
    ]);

    expect(data.links.map((link) => link.href)).toEqual(["https://example.com/talk"]);
  });

  it("orders by time rather than by the order the pages arrived in", () => {
    const data = collectIndexedPanelItems([
      message("late", "u1", "2026-08-03T10:00:00Z", "https://example.com/late"),
      message("early", "u1", "2026-08-01T10:00:00Z", "https://example.com/early"),
    ]);

    expect(data.links.map((link) => link.href)).toEqual([
      "https://example.com/late",
      "https://example.com/early",
    ]);
  });

  it("does not change the list it was given", () => {
    const messages = [
      message("b", "u1", "2026-08-02T10:00:00Z", ""),
      message("a", "u1", "2026-08-01T10:00:00Z", ""),
    ];

    collectIndexedPanelItems(messages);

    expect(messages.map((m) => m.id)).toEqual(["b", "a"]);
  });
});
