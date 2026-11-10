import { describe, expect, it } from "vitest";

import {
  OFFLINE_AVATAR,
  avatarColor,
  hueFor,
  identityVars,
  nameColor,
} from "@/design/identity";

describe("per-person colour", () => {
  it("gives a person the same hue every time", () => {
    expect(hueFor("person-42")).toBe(hueFor("person-42"));
  });

  it("uses twelve evenly spaced hues", () => {
    const hues = new Set(
      Array.from({ length: 500 }, (_, index) => hueFor(`person-${index}`)),
    );

    expect([...hues].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, stop) => (277 + stop * 30) % 360).sort(
        (a, b) => a - b,
      ),
    );
  });

  it("derives the avatar fill and the name colour from the same hue", () => {
    const hue = hueFor("person-7");

    expect(avatarColor("person-7")).toBe(`oklch(0.58 0.17 ${hue})`);
    expect(nameColor("person-7")).toBe(`oklch(0.79 0.14 ${hue})`);
  });

  it("sets the person variables from the id", () => {
    expect(identityVars("person-7")).toEqual({
      "--person-bg": avatarColor("person-7"),
      "--person-name": nameColor("person-7"),
    });
  });

  it("drops the hue for someone who is offline", () => {
    expect(identityVars("person-7", true)).toEqual({
      "--person-bg": OFFLINE_AVATAR,
      "--person-name": "var(--text-faint)",
    });
  });
});
