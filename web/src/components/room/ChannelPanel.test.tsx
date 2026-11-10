import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChannelPanel } from "./ChannelPanel";

describe("ChannelPanel tabs", () => {
  it("shows search, pin, media and link tabs with their icons", () => {
    render(
      <ChannelPanel
        open
        tab="pinned"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        searchQuery=""
        searchResults={[]}
        searchLoading={false}
        onSearchQueryChange={vi.fn()}
        media={[]}
        links={[]}
        pinned={[]}
        pinsSupported
      />,
    );

    for (const label of ["Szukaj", "Przypięte", "Multimedia", "Linki"]) {
      expect(screen.getByRole("tab", { name: label }).querySelector("svg")).not.toBeNull();
    }
  });
});
