import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CustomEmoji } from "@/ports";

import {
  CustomStatusText,
  parseProfileBio,
  ProfileBioText,
} from "./ProfileBio";

const party: CustomEmoji = {
  id: "emoji-party",
  shortcode: ":party:",
  glyph: "/emoji/party.webp",
};

describe("parseProfileBio", () => {
  it("returns plain text as one node and nothing for an empty bio", () => {
    expect(parseProfileBio("")).toEqual([]);
    expect(parseProfileBio("just words")).toEqual([
      { kind: "text", text: "just words" },
    ]);
  });

  it("parses formatting between runs of text", () => {
    expect(parseProfileBio("a **b** c *d* e")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " c " },
      { kind: "emphasis", text: "d" },
      { kind: "text", text: " e" },
    ]);
  });

  it("leaves unclosed markers as typed", () => {
    expect(parseProfileBio("**open and half")).toEqual([
      { kind: "text", text: "**open and half" },
    ]);
  });

  it("does not let formatting span lines", () => {
    expect(parseProfileBio("**one\ntwo**")).toEqual([
      { kind: "text", text: "**one\ntwo**" },
    ]);
  });

  it("links only http and https addresses", () => {
    expect(parseProfileBio("[a](http://a.test) [b](ftp://b.test)")).toEqual([
      { kind: "link", href: "http://a.test", text: "a" },
      { kind: "text", text: " [b](ftp://b.test)" },
    ]);
  });

  it("keeps a labelled link's own text instead of its address", () => {
    expect(parseProfileBio("[my page](https://example.com/me)")).toEqual([
      { kind: "link", href: "https://example.com/me", text: "my page" },
    ]);
  });

  it("gives closing brackets back to the sentence unless the address uses them", () => {
    expect(parseProfileBio("(see https://example.com/a)")).toEqual([
      { kind: "text", text: "(see " },
      {
        kind: "link",
        href: "https://example.com/a",
        text: "https://example.com/a",
      },
      { kind: "text", text: ")" },
    ]);
    expect(parseProfileBio("https://en.wikipedia.org/wiki/Foo_(bar)!")).toEqual([
      {
        kind: "link",
        href: "https://en.wikipedia.org/wiki/Foo_(bar)",
        text: "https://en.wikipedia.org/wiki/Foo_(bar)",
      },
      { kind: "text", text: "!" },
    ]);
  });

  it("finds a second address after the punctuation it gave back", () => {
    const nodes = parseProfileBio("https://a.test, https://b.test");

    expect(nodes.filter((node) => node.kind === "link")).toEqual([
      { kind: "link", href: "https://a.test", text: "https://a.test" },
      { kind: "link", href: "https://b.test", text: "https://b.test" },
    ]);
  });

  it("matches emoji by shortcode whether or not the server stored the colons", () => {
    const bare: CustomEmoji = { ...party, shortcode: "party" };

    for (const emoji of [party, bare]) {
      expect(parseProfileBio("x :party:", [emoji])).toEqual([
        { kind: "text", text: "x " },
        { kind: "emoji", glyph: "/emoji/party.webp", shortcode: "party" },
      ]);
    }
  });

  it("keeps an unknown shortcode as typed, in a text run of its own", () => {
    expect(parseProfileBio("hi :nope: there", [party])).toEqual([
      { kind: "text", text: "hi " },
      { kind: "text", text: ":nope:" },
      { kind: "text", text: " there" },
    ]);
  });

  it("keeps punctuation given back by a bare address apart from the text after it", () => {
    expect(parseProfileBio("see https://a.test. :nope:")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", href: "https://a.test", text: "https://a.test" },
      { kind: "text", text: ". " },
      { kind: "text", text: ":nope:" },
    ]);
  });

  it("is not affected by an earlier parse", () => {
    const first = parseProfileBio("https://a.test.");
    const second = parseProfileBio("https://a.test.");

    expect(second).toEqual(first);
  });
});

describe("ProfileBioText", () => {
  it("shows the typed text of anything that is not an allowed link", () => {
    render(
      <p>
        <ProfileBioText text="[x](javascript:alert(1))" />
      </p>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("[x](javascript:alert(1))")).toBeInTheDocument();
  });

  it("opens every link in a new context without passing the opener on", () => {
    render(
      <p>
        <ProfileBioText text="https://example.com" />
      </p>,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer", "nofollow", "ugc"]),
    );
  });

  it("does not turn authored angle brackets into elements", () => {
    const { container } = render(
      <p>
        <ProfileBioText text="<b>loud</b> <script>1</script>" />
      </p>,
    );

    expect(container.querySelector("b, script")).toBeNull();
    expect(container.textContent).toBe("<b>loud</b> <script>1</script>");
  });
});

describe("CustomStatusText", () => {
  it("leaves an unknown shortcode as typed and keeps Markdown literal", () => {
    const { container } = render(
      <p>
        <CustomStatusText text="**x** :nope: :party:" customEmoji={[party]} />
      </p>,
    );

    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("**x** :nope: ");
    expect(screen.getByRole("img", { name: ":party:" })).toHaveAttribute(
      "title",
      ":party:",
    );
  });
});
