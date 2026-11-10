import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("GifBrowser", () => {
  beforeEach(() => {
    giphy.fetchPage.mockReset();
    giphy.resolveApiKey.mockReset();
    giphy.trackAction.mockReset();
    giphy.resolveApiKey.mockResolvedValue("test-key");
    giphy.fetchPage.mockResolvedValue({
      items: [],
      offset: 0,
      count: 0,
      totalCount: 0,
    });
  });

  it("opens as a labelled browser and returns focus through its explicit close action", async () => {
    const user = userEvent.setup();

    // The component deliberately carries a translation fallback, so this
    // focused interaction test needs no route-level provider.
    render(
      <GifBrowser apiKey="test-key" customerId="customer" onSelect={vi.fn()} />,
    );

    const open = screen.getByRole("button", { name: "Przeglądaj GIF-y" });
    expect(open).toHaveAttribute("aria-expanded", "false");

    await user.click(open);

    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("dialog", { name: "Przeglądarka GIF-ów" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("searchbox", { name: "Szukaj GIF-ów" })).toHaveFocus();
    });

    await user.click(
      screen.getByRole("button", { name: "Zamknij przeglądarkę GIF-ów" }),
    );

    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open).toHaveFocus();
  });

  it("sends the chosen result immediately and restores the trigger", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    giphy.fetchPage.mockResolvedValue({
      items: [{
        id: "wave",
        pageUrl: "https://giphy.com/gifs/wave",
        title: "Machanie",
        alt: "Osoba macha ręką",
        previewUrl: "https://media.giphy.com/preview.gif",
        mediaUrl: "https://media.giphy.com/original.gif",
        width: 320,
        height: 240,
        analytics: {},
      }],
      offset: 0,
      count: 1,
      totalCount: 1,
    });

    render(
      <GifBrowser apiKey="test-key" customerId="customer" onSelect={onSelect} />,
    );

    const trigger = screen.getByRole("button", { name: "Przeglądaj GIF-y" });
    await user.click(trigger);
    await user.click(
      await screen.findByRole("button", { name: "Wyślij GIF: Osoba macha ręką" }),
    );

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("https://giphy.com/gifs/wave");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).toHaveFocus();
  });
});
