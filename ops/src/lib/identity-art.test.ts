import { describe, expect, it } from "vitest";

import { defaultAvatarUrl } from "@/lib/identity-art";

describe("defaultAvatarUrl", () => {
  // Expected numbers come from the web client's defaultIdentityArt, which must agree.
  it.each([
    ["", "02"],
    ["a", "01"],
    ["stellarr", "17"],
    ["11111111-2222-4333-8444-555555555555", "19"],
    ["Żółć", "13"],
    ["😀", "13"],
  ])("picks the web client's default picture for %j", (id, number) => {
    expect(defaultAvatarUrl(id)).toBe(`/identity/defaults/${number}/avatar.svg`);
  });

  it("always points at one of the twenty shipped pictures", () => {
    for (let index = 0; index < 500; index++) {
      const url = defaultAvatarUrl(`user-${index}`);
      const number = Number(/^\/identity\/defaults\/(\d\d)\/avatar\.svg$/.exec(url)?.[1]);
      expect(number).toBeGreaterThanOrEqual(1);
      expect(number).toBeLessThanOrEqual(20);
    }
  });

  it("is stable for the same id", () => {
    expect(defaultAvatarUrl("stellarr")).toBe(defaultAvatarUrl("stellarr"));
  });
});
