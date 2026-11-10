import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CustomStatusText,
  parseProfileBio,
  ProfileBioText,
} from "./ProfileBio";

describe("ProfileBio", () => {
  it("renders the formatting offered by the account menu", () => {
    render(
      <p>
        <ProfileBioText text="Lubię **dobry dźwięk** i *nocne rozmowy*." />
      </p>,
    );

    expect(screen.getByText("dobry dźwięk").tagName).toBe("STRONG");
    expect(screen.getByText("nocne rozmowy").tagName).toBe("EM");
  });

  it("allows only authored http links and opens them outside the app", () => {
    render(
      <p>
        <ProfileBioText text="[Portfolio](https://example.com) javascript:alert(1)" />
      </p>,
    );

    expect(screen.getByRole("link", { name: "Portfolio" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.getByRole("link", { name: "Portfolio" })).toHaveAttribute(
      "rel",
      expect.stringContaining("noopener"),
    );
    expect(screen.getByText(/javascript:alert/)).toBeInTheDocument();
  });

  it("keeps unsupported markup literal and sentence punctuation outside a bare URL", () => {
    expect(parseProfileBio("<img src=x> https://example.com/a.")).toEqual([
      { kind: "text", text: "<img src=x> " },
      {
        kind: "link",
        href: "https://example.com/a",
        text: "https://example.com/a",
      },
      { kind: "text", text: "." },
    ]);
  });

  it("renders known server emoji and leaves unknown shortcodes as text", () => {
    render(
      <p>
        <ProfileBioText
          text="Hej :party: :unknown:"
          customEmoji={[
            {
              id: "emoji-party",
              shortcode: ":party:",
              glyph: "/emoji/party.webp",
            },
          ]}
        />
      </p>,
    );

    expect(screen.getByRole("img", { name: ":party:" })).toHaveAttribute(
      "src",
      "/emoji/party.webp",
    );
    expect(screen.getByText(/:unknown:/)).toBeInTheDocument();
  });

  it("keeps links in a compact status as text while rendering custom emoji", () => {
    render(
      <button type="button">
        <CustomStatusText
          text="https://example.com :party:"
          customEmoji={[
            {
              id: "emoji-party",
              shortcode: ":party:",
              glyph: "/emoji/party.webp",
            },
          ]}
        />
      </button>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/https:\/\/example.com/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: ":party:" })).toHaveAttribute(
      "src",
      "/emoji/party.webp",
    );
  });
});
