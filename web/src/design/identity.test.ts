import { describe, expect, it } from "vitest";

import {
  DEFAULT_IDENTITY_ART_COUNT,
  defaultIdentityArt,
} from "@/design/identity";

describe("default identity artwork", () => {
  it("keeps an avatar and banner on the same stable pair", () => {
    const first = defaultIdentityArt("person-42");
    const second = defaultIdentityArt("person-42");

    expect(second).toEqual(first);
    expect(first.avatarUrl).toMatch(/^\/identity\/defaults\/\d{2}\/avatar\.svg$/);
    expect(first.bannerUrl).toBe(first.avatarUrl.replace("avatar.svg", "banner.svg"));
  });

  it("can reach every generated pair", () => {
    const selected = new Set(
      Array.from({ length: 2_000 }, (_, index) =>
        defaultIdentityArt(`person-${index}`).avatarUrl,
      ),
    );

    expect(selected).toHaveLength(DEFAULT_IDENTITY_ART_COUNT);
  });
});
