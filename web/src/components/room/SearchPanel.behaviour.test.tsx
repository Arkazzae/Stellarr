import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/ports";

import { SearchPanel, type SearchPanelProps } from "./SearchPanel";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    channelId: "c1",
    author: { id: "u1", displayName: "Ada" },
    content: "Plan projektu",
    attachments: [],
    embeds: [],
    createdAt: "2026-08-10T12:00:00Z",
    ...overrides,
  };
}

function panel(overrides: Partial<SearchPanelProps> = {}) {
  return (
    <SearchPanel
      query="plan"
      results={[]}
      loading={false}
      onQueryChange={vi.fn()}
      {...overrides}
    />
  );
}

describe("SearchPanel states", () => {
  it("says it is loading instead of guessing between guidance and an empty result", () => {
    render(panel({ loading: true, results: [] }));

    expect(screen.getByText("Wczytywanie…")).toBeInTheDocument();
    expect(screen.queryByText("Brak pasujących wiadomości.")).not.toBeInTheDocument();
  });

  it("keeps asking for more until the query has two visible characters", () => {
    const { rerender } = render(panel({ query: "a " }));
    const hint = "Szukaj w całej historii: wiadomościach, nazwach plików i linkach.";

    expect(screen.getByText(hint)).toBeInTheDocument();

    rerender(panel({ query: "ab" }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(screen.getByText("Brak pasujących wiadomości.")).toBeInTheDocument();
  });

  it("reports a failed search with a retry, and does not call that an empty result", async () => {
    const onRetry = vi.fn();
    render(panel({ error: "Indeks jest niedostępny", onRetry }));

    expect(screen.getByRole("alert")).toHaveTextContent("Indeks jest niedostępny");
    expect(screen.queryByText("Brak pasujących wiadomości.")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers no retry when the host gave none", () => {
    render(panel({ error: "Indeks jest niedostępny" }));

    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
  });
});

describe("SearchPanel results", () => {
  it("names a message that is only attachments instead of showing an empty line", () => {
    render(panel({ results: [message({ content: "" })] }));

    expect(screen.getByText("Wiadomość z załącznikiem")).toBeInTheDocument();
  });

  it("lists a link by its URL when the unfurl had no title", () => {
    const embed = {
      id: "e1",
      url: "https://example.com/brief",
      kind: "link" as const,
      provider: "example.com",
      domain: "example.com",
      title: "",
    };
    render(panel({ results: [message({ embeds: [embed] })] }));

    expect(screen.getByText("https://example.com/brief")).toBeInTheDocument();
  });

  it("lists nothing after the text of a result that has no files or links", () => {
    render(panel({ results: [message()] }));

    expect(screen.getByRole("button", { name: /Plan projektu/ })).toHaveTextContent(
      /^Ada.+Plan projektu$/,
    );
  });
});

describe("SearchPanel paging", () => {
  it("loads the next older page on request", async () => {
    const onLoadMore = vi.fn();
    render(panel({ results: [message()], hasMore: true, onLoadMore }));

    await userEvent.setup().click(screen.getByRole("button", { name: "Pokaż starsze wyniki" }));

    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("disables the button while a page is on its way", () => {
    render(panel({ results: [message()], hasMore: true, loadingMore: true }));

    expect(screen.getByRole("button", { name: "Wczytywanie…" })).toBeDisabled();
  });

  it("shows no button once the index is exhausted", () => {
    render(panel({ results: [message()] }));

    expect(screen.queryByRole("button", { name: "Pokaż starsze wyniki" })).not.toBeInTheDocument();
  });
});
