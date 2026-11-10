import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchPanel } from "./SearchPanel";

vi.mock("@/state/hooks", () => ({
  useLanguage: () => ({
    locale: "pl",
    t: (key: string) => key,
  }),
}));

describe("SearchPanel", () => {
  it("shows guidance before a query and an empty state after it", () => {
    const onQueryChange = vi.fn();
    const view = render(
      <SearchPanel
        query=""
        results={[]}
        loading={false}
        onQueryChange={onQueryChange}
      />,
    );

    expect(screen.getByText("room.searchIndexHint")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "plan" } });
    expect(onQueryChange).toHaveBeenCalledWith("plan");

    view.rerender(
      <SearchPanel
        query="brak"
        results={[]}
        loading={false}
        onQueryChange={onQueryChange}
      />,
    );
    expect(screen.getByText("room.searchEmpty")).toBeInTheDocument();
  });

  it("shows indexed file and link details and opens the complete result", () => {
    const onOpenResult = vi.fn();
    const message = {
      id: "m1",
      channelId: "c1",
      author: { id: "u1", displayName: "Ada" },
      content: "Plan projektu",
      createdAt: "2026-08-10T12:00:00Z",
      attachments: [
        {
          id: "a1",
          url: "/assets/a1",
          name: "harmonogram.pdf",
          contentType: "application/pdf",
          size: 42,
        },
      ],
      embeds: [
        {
          id: "e1",
          url: "https://example.com/brief",
          kind: "link" as const,
          provider: "example.com",
          domain: "example.com",
          title: "Brief",
        },
      ],
    };

    render(
      <SearchPanel
        query="harmonogram"
        results={[message]}
        loading={false}
        onQueryChange={vi.fn()}
        onOpenResult={onOpenResult}
      />,
    );

    expect(screen.getByText("harmonogram.pdf · Brief")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Plan projektu/ }));
    expect(onOpenResult).toHaveBeenCalledWith(message);
  });
});
