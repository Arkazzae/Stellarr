import { describe, expect, it } from "vitest";

import { collectIndexedPanelItems, collectPanelItems } from "./channelPanelModel";
import type { TranscriptSectionVM } from "./Transcript";
import type { MessagePart } from "./parts";

function group(id: string, timestamp: string, parts: MessagePart[]) {
  // One body per block here: the panel walks messages, and these fixtures are
  // about which parts it picks out, not about how a block is grouped.
  return {
    id,
    authorId: "u-ada",
    authorName: "Ada",
    timestamp,
    bodies: [{ id, parts }],
  };
}

function sections(
  ...groups: ReturnType<typeof group>[]
): TranscriptSectionVM[] {
  return [{ day: "Dziś", groups }];
}

describe("collectPanelItems", () => {
  it("lists media newest first and takes galleries apart", () => {
    const data = collectPanelItems(
      sections(
        group("g1", "2026-08-13T10:00:00Z", [
          {
            kind: "gallery",
            images: [
              { src: "/a.png", alt: "a" },
              { src: "/b.png", alt: "b" },
            ],
          },
        ]),
        group("g2", "2026-08-13T11:00:00Z", [
          { kind: "file", name: "raport.pdf", ext: "PDF", size: "1 MB" },
        ]),
      ),
    );

    expect(data.media.map((item) => item.part.kind)).toEqual([
      "file",
      "image",
      "image",
    ]);
    // The gallery keeps its own order inside the block it came from.
    expect(data.media[1]?.part).toMatchObject({ src: "/a.png" });
    expect(data.media[0]).toMatchObject({
      authorName: "Ada",
      timestamp: "2026-08-13T11:00:00Z",
    });
  });

  it("collects complete server-indexed message pages in newest-first order", () => {
    const data = collectIndexedPanelItems([
      {
        id: "old",
        channelId: "c1",
        author: { id: "u1", displayName: "Ada" },
        content: "",
        createdAt: "2026-08-01T10:00:00Z",
        attachments: [
          {
            id: "a1",
            url: "/assets/a1",
            name: "old.png",
            contentType: "image/png",
            size: 10,
          },
        ],
        embeds: [],
      },
      {
        id: "new",
        channelId: "c1",
        author: { id: "u2", displayName: "Maja" },
        content: "https://example.com/new",
        createdAt: "2026-08-02T10:00:00Z",
        attachments: [],
        embeds: [],
      },
    ]);

    expect(data.media[0]?.id).toBe("old:0");
    expect(data.links[0]).toMatchObject({
      id: "new:0:0",
      href: "https://example.com/new",
    });
  });

  it("collects both bare links and unfurled cards", () => {
    const data = collectPanelItems(
      sections(
        group("g1", "2026-08-13T10:00:00Z", [
          {
            kind: "text",
            nodes: [
              { kind: "text", text: "zobacz " },
              {
                kind: "link",
                href: "https://www.example.com/a",
                text: "https://www.example.com/a",
              },
            ],
          },
        ]),
        group("g2", "2026-08-13T11:00:00Z", [
          {
            kind: "embed",
            domain: "orbit.dev",
            title: "Orbit",
            description: "opis",
            url: "https://orbit.dev/post",
            thumb: "/t.png",
          },
        ]),
      ),
    );

    expect(data.links).toEqual([
      {
        id: "g2:0",
        href: "https://orbit.dev/post",
        title: "Orbit",
        domain: "orbit.dev",
        thumb: "/t.png",
        authorName: "Ada",
        timestamp: "2026-08-13T11:00:00Z",
      },
      {
        id: "g1:0:1",
        href: "https://www.example.com/a",
        title: "https://www.example.com/a",
        domain: "example.com",
        authorName: "Ada",
        timestamp: "2026-08-13T10:00:00Z",
      },
    ]);
  });

  it("keeps only the newest posting of the same link", () => {
    const data = collectPanelItems(
      sections(
        group("g1", "2026-08-13T10:00:00Z", [
          {
            kind: "text",
            nodes: [
              { kind: "link", href: "https://orbit.dev/x", text: "x" },
            ],
          },
        ]),
        group("g2", "2026-08-13T12:00:00Z", [
          {
            kind: "text",
            nodes: [
              { kind: "link", href: "https://orbit.dev/x", text: "x" },
            ],
          },
        ]),
      ),
    );

    expect(data.links).toHaveLength(1);
    expect(data.links[0]?.timestamp).toBe("2026-08-13T12:00:00Z");
  });

  it("collects parts from every message in an author block", () => {
    const data = collectPanelItems([
      {
        day: "Dziś",
        groups: [
          {
            ...group("g1", "2026-08-13T10:00:00Z", []),
            bodies: [
              {
                id: "m1",
                parts: [{ kind: "image", src: "/first.png", alt: "first" }],
              },
              {
                id: "m2",
                parts: [{ kind: "file", name: "second.pdf", ext: "PDF", size: "1 MB" }],
              },
            ],
          },
        ],
      },
    ]);

    expect(data.media.map((item) => item.id)).toEqual(["m2:0", "m1:0"]);
  });

  it("ignores pastes, GIFs and server notices", () => {
    const data = collectPanelItems([
      {
        day: "Dziś",
        groups: [
          {
            id: "g1",
            authorId: "system",
            authorName: "System",
            system: true,
            timestamp: "2026-08-13T10:00:00Z",
            bodies: [
              {
                id: "g1",
                parts: [
                  { kind: "image", src: "/joined.png", alt: "" },
                  {
                    kind: "text",
                    nodes: [
                      { kind: "link", href: "https://orbit.dev/rules", text: "r" },
                    ],
                  },
                ],
              },
            ],
          },
          group("g2", "2026-08-13T11:00:00Z", [
            { kind: "code", lang: "ts", tokens: [] },
            { kind: "giphy", id: "abc", pageUrl: "https://giphy.com/gifs/abc" },
          ]),
        ],
      },
    ]);

    expect(data).toEqual({ media: [], links: [] });
  });
});
