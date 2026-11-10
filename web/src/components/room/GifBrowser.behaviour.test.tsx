import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GiphyGif, GiphyPage } from "@/lib/giphy";

import { GifBrowser } from "./GifBrowser";

const giphy = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  resolveApiKey: vi.fn(),
  trackAction: vi.fn(),
}));

vi.mock("@/lib/giphy", () => ({
  fetchGiphyPage: giphy.fetchPage,
  resolveGiphyApiKey: giphy.resolveApiKey,
  trackGiphyAction: giphy.trackAction,
}));

function gif(id: string, analytics: GiphyGif["analytics"] = {}): GiphyGif {
  return {
    id,
    pageUrl: `https://giphy.com/gifs/${id}`,
    title: id,
    alt: `GIF ${id}`,
    previewUrl: `https://media.giphy.com/${id}.gif`,
    mediaUrl: `https://media.giphy.com/${id}-full.gif`,
    width: 320,
    height: 240,
    analytics,
  };
}

function page(items: GiphyGif[], totalCount = items.length): GiphyPage {
  return { items, offset: 0, count: items.length, totalCount };
}

function renderBrowser(onSelect = vi.fn().mockResolvedValue(undefined)) {
  render(<GifBrowser apiKey="key" customerId="customer" onSelect={onSelect} />);
  return { onSelect, trigger: screen.getByRole("button", { name: "Przeglądaj GIF-y" }) };
}

beforeEach(() => {
  giphy.fetchPage.mockReset().mockResolvedValue(page([]));
  giphy.resolveApiKey.mockReset().mockResolvedValue("resolved-key");
  giphy.trackAction.mockReset();
});

describe("GifBrowser loading", () => {
  it("fetches nothing until it is opened, then shows the popular list", async () => {
    giphy.fetchPage.mockResolvedValue(page([gif("a")]));
    const { trigger } = renderBrowser();
    expect(giphy.fetchPage).not.toHaveBeenCalled();

    await userEvent.click(trigger);

    expect(await screen.findByRole("button", { name: "Wyślij GIF: GIF a" })).toBeInTheDocument();
    expect(screen.getByText("Popularne")).toBeInTheDocument();
    expect(giphy.fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "resolved-key", customerId: "customer", query: "" }),
    );
  });

  it("searches once typing pauses, not on every keystroke", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Przeglądaj GIF-y" }));
    await waitFor(() => expect(giphy.fetchPage).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByRole("searchbox", { name: "Szukaj GIF-ów" }), "kot");

    await waitFor(() =>
      expect(giphy.fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ query: "kot" })),
    );
    const queries = giphy.fetchPage.mock.calls.map(([options]) => options.query);
    expect(queries).toEqual(["", "kot"]);
    expect(screen.getByText("Wyniki dla „kot”")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Przeglądaj GIF-y" }));
    expect(await screen.findByText("Brak GIF-ów dla tego wyszukiwania.")).toBeInTheDocument();
  });

  it("offers a retry after a failed load and recovers", async () => {
    giphy.fetchPage.mockRejectedValueOnce(new Error("offline"));
    renderBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Przeglądaj GIF-y" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się pobrać GIF-ów.");

    giphy.fetchPage.mockResolvedValue(page([gif("a")]));
    await userEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("button", { name: "Wyślij GIF: GIF a" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("appends the next page without repeating a GIF", async () => {
    giphy.fetchPage
      .mockResolvedValueOnce(page([gif("a"), gif("b")], 3))
      .mockResolvedValueOnce(page([gif("b"), gif("c")], 3));
    renderBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Przeglądaj GIF-y" }));

    await userEvent.click(await screen.findByRole("button", { name: "Pokaż więcej" }));

    expect(await screen.findByRole("button", { name: "Wyślij GIF: GIF c" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Wyślij GIF/ })).toHaveLength(3);
    expect(giphy.fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }));
    expect(screen.queryByRole("button", { name: "Pokaż więcej" })).toBeNull();
  });

  it("keeps the results and reports it when the next page fails", async () => {
    giphy.fetchPage
      .mockResolvedValueOnce(page([gif("a")], 2))
      .mockRejectedValueOnce(new Error("offline"));
    renderBrowser();
    await userEvent.click(screen.getByRole("button", { name: "Przeglądaj GIF-y" }));

    await userEvent.click(await screen.findByRole("button", { name: "Pokaż więcej" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się pobrać GIF-ów.");
    expect(screen.getByRole("button", { name: "Wyślij GIF: GIF a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pokaż więcej" })).toBeEnabled();
  });
});

describe("GifBrowser sending", () => {
  it("stays open and reports it when the message could not be sent", async () => {
    giphy.fetchPage.mockResolvedValue(page([gif("a")]));
    const { trigger, onSelect } = renderBrowser(vi.fn().mockRejectedValue(new Error("no")));
    await userEvent.click(trigger);

    await userEvent.click(await screen.findByRole("button", { name: "Wyślij GIF: GIF a" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się wysłać GIF-a. Spróbuj ponownie.",
    );
    expect(onSelect).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Wyślij GIF: GIF a" })).toBeEnabled();
  });

  it("reports the click before sending and the send after it succeeds", async () => {
    giphy.fetchPage.mockResolvedValue(
      page([gif("a", { onclick: "https://giphy-analytics.giphy.com/click", onsent: "https://giphy-analytics.giphy.com/sent" })]),
    );
    const { trigger } = renderBrowser();
    await userEvent.click(trigger);

    await userEvent.click(await screen.findByRole("button", { name: "Wyślij GIF: GIF a" }));

    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(giphy.trackAction.mock.calls.map(([url]) => url)).toEqual([
      "https://giphy-analytics.giphy.com/click",
      "https://giphy-analytics.giphy.com/sent",
    ]);
  });

  it("does not report a send that failed", async () => {
    giphy.fetchPage.mockResolvedValue(
      page([gif("a", { onsent: "https://giphy-analytics.giphy.com/sent" })]),
    );
    const { trigger } = renderBrowser(vi.fn().mockRejectedValue(new Error("no")));
    await userEvent.click(trigger);

    await userEvent.click(await screen.findByRole("button", { name: "Wyślij GIF: GIF a" }));
    await screen.findByRole("alert");

    expect(giphy.trackAction).not.toHaveBeenCalledWith(
      "https://giphy-analytics.giphy.com/sent",
      expect.anything(),
    );
  });

  it("reports a view once, however often the image loads", async () => {
    giphy.fetchPage.mockResolvedValue(
      page([gif("a", { onload: "https://giphy-analytics.giphy.com/load" })]),
    );
    const { trigger } = renderBrowser();
    await userEvent.click(trigger);
    const tile = await screen.findByRole("button", { name: "Wyślij GIF: GIF a" });

    const image = tile.querySelector("img")!;
    fireEvent.load(image);
    fireEvent.load(image);

    expect(giphy.trackAction).toHaveBeenCalledExactlyOnceWith(
      "https://giphy-analytics.giphy.com/load",
      "customer",
    );
  });
});

describe("GifBrowser dismissal", () => {
  it("closes on Escape and gives focus back to the trigger", async () => {
    const { trigger } = renderBrowser();
    await userEvent.click(trigger);

    await userEvent.keyboard("{Escape}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes when the pointer goes down outside it", async () => {
    const { trigger } = renderBrowser();
    await userEvent.click(trigger);

    fireEvent.pointerDown(document.body);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open for presses inside the panel", async () => {
    const { trigger } = renderBrowser();
    await userEvent.click(trigger);

    await userEvent.click(screen.getByRole("searchbox", { name: "Szukaj GIF-ów" }));

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
