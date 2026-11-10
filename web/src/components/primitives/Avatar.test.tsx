import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { defaultIdentityArt } from "@/design/identity";

import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("uses stable built-in artwork when a person has no upload", () => {
    const { container } = render(
      <Avatar id="person-42" displayName="Patrycja Nowak" />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      defaultIdentityArt("person-42").avatarUrl,
    );
    expect(container.textContent).toContain("PN");
  });

  it("prefers an uploaded avatar", () => {
    const { container } = render(
      <Avatar
        id="person-42"
        displayName="Patrycja Nowak"
        avatarUrl="/assets/uploaded-avatar.webp"
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/uploaded-avatar.webp",
    );
  });

  it("keeps system notices as glyphs", () => {
    const { container } = render(
      <Avatar id="system" displayName="System" initials="S" system />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("S");
  });

  it("shows a server icon for a system notice when one is available", () => {
    const { container } = render(
      <Avatar
        id="system"
        displayName="Orbit"
        avatarUrl="/assets/orbit.webp"
        system
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/orbit.webp",
    );
    expect(container.textContent).toContain("O");
  });
});
