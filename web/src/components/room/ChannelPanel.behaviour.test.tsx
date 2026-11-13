import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/primitives/Modal";

import type { MediaItemVM, PinnedMessageVM } from "./channelPanelModel";
import { ChannelPanel, type ChannelPanelProps } from "./ChannelPanel";

function panel(overrides: Partial<ChannelPanelProps> = {}) {
  return (
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
      {...overrides}
    />
  );
}

const origin = { authorName: "Ada", timestamp: "2026-08-10T12:00:00Z" };

function photo(id: string, alt: string): MediaItemVM {
  return { id, part: { kind: "image", src: `/media/${id}.png`, alt }, ...origin };
}

function pin(id: string, overrides: Partial<PinnedMessageVM> = {}): PinnedMessageVM {
  return {
    id,
    authorId: "u1",
    authorName: "Ada",
    preview: "Spotkanie o dziesiątej",
    timestamp: "2026-08-10T12:00:00Z",
    pinnedAt: "2026-08-11T09:00:00Z",
    ...overrides,
  };
}

describe("ChannelPanel tab strip", () => {
  it("marks the current tab and gives only that one a tab stop", () => {
    render(panel({ tab: "media" }));

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0, -1]);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[2]?.id);
  });

  it("switches tabs on click", async () => {
    const onTabChange = vi.fn();
    render(panel({ onTabChange }));

    await userEvent.setup().click(screen.getByRole("tab", { name: "Linki" }));

    expect(onTabChange).toHaveBeenCalledWith("links");
  });

  it("moves focus and selection with the arrow keys, wrapping at both ends", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(panel({ tab: "search", onTabChange }));

    screen.getByRole("tab", { name: "Szukaj" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Przypięte" })).toHaveFocus();
    expect(onTabChange).toHaveBeenLastCalledWith("pinned");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Linki" })).toHaveFocus();
    expect(onTabChange).toHaveBeenLastCalledWith("links");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Szukaj" })).toHaveFocus();
    expect(onTabChange).toHaveBeenLastCalledWith("search");
  });

  it("jumps to the first and last tab with Home and End", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(panel({ tab: "pinned", onTabChange }));

    screen.getByRole("tab", { name: "Przypięte" }).focus();
    await user.keyboard("{End}");
    expect(onTabChange).toHaveBeenLastCalledWith("links");
    expect(screen.getByRole("tab", { name: "Linki" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(onTabChange).toHaveBeenLastCalledWith("search");
    expect(screen.getByRole("tab", { name: "Szukaj" })).toHaveFocus();
  });

  it("leaves other keys to the browser", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(panel({ onTabChange }));

    screen.getByRole("tab", { name: "Przypięte" }).focus();
    await user.keyboard("a{ArrowDown}");

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("shows the search field only on the search tab", () => {
    const { rerender } = render(panel({ tab: "search", searchQuery: "plan" }));
    expect(screen.getByRole("searchbox")).toHaveValue("plan");

    rerender(panel({ tab: "pinned" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("passes what is typed in the search field to the host", async () => {
    const onSearchQueryChange = vi.fn();
    render(panel({ tab: "search", onSearchQueryChange }));

    await userEvent.setup().type(screen.getByRole("searchbox"), "p");

    expect(onSearchQueryChange).toHaveBeenCalledWith("p");
  });
});

describe("ChannelPanel closing", () => {
  it("closes from its own button", async () => {
    const onClose = vi.fn();
    render(panel({ onClose }));

    await userEvent.setup().click(screen.getByRole("button", { name: "Zamknij panel" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("takes itself out of reach while closed, without dropping its lists", () => {
    const { container, rerender } = render(panel({ open: false, pinned: [pin("m1")] }));
    const aside = container.querySelector("aside");

    expect(aside).toHaveAttribute("inert");
    expect(aside).not.toHaveClass("open");
    expect(screen.getByText("Spotkanie o dziesiątej")).toBeInTheDocument();

    rerender(panel({ open: true, pinned: [pin("m1")] }));
    expect(aside).not.toHaveAttribute("inert");
    expect(aside).toHaveClass("open");
  });

  it("closes on Escape and keeps the key from reaching the shell behind it", async () => {
    const onClose = vi.fn();
    const shell = vi.fn();
    window.addEventListener("keydown", shell);
    render(panel({ onClose }));

    await userEvent.setup().keyboard("{Escape}");
    window.removeEventListener("keydown", shell);

    expect(onClose).toHaveBeenCalledOnce();
    expect(shell).not.toHaveBeenCalled();
  });

  it("ignores Escape while it is closed", async () => {
    const onClose = vi.fn();
    render(panel({ open: false, onClose }));

    await userEvent.setup().keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape to a modal dialog in front of it", async () => {
    const onClose = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    render(panel({ onClose }));

    try {
      await userEvent.setup().keyboard("{Escape}");
    } finally {
      dialog.remove();
    }

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ChannelPanel beside a dialog", () => {
  it("leaves Escape to a dialog in front of it, even when it joined the stack after the dialog", async () => {
    const onClose = vi.fn();
    const onDialogClose = vi.fn();
    const tree = (panelOpen: boolean) => (
      <>
        <Modal open onClose={onDialogClose} labelledBy="dialog-title" className="sv-wrap">
          <h2 id="dialog-title">Ustawienia</h2>
        </Modal>
        {panel({ open: panelOpen, onClose })}
      </>
    );
    const { rerender } = render(tree(false));

    // Leaving a call from a keybind opens the panel while the dialog is up.
    rerender(tree(true));
    await userEvent.setup().keyboard("{Escape}");

    expect(onDialogClose).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ChannelPanel pins", () => {
  it("jumps to a pinned message when its row is opened", async () => {
    const onOpenPin = vi.fn();
    render(panel({ pinned: [pin("m1"), pin("m2", { preview: "Lista zakupów" })], onOpenPin }));

    await userEvent.setup().click(screen.getByRole("button", { name: /Lista zakupów/ }));

    expect(onOpenPin).toHaveBeenCalledExactlyOnceWith("m2");
  });

  it("keeps a pin readable but not clickable when the host cannot jump", () => {
    render(panel({ pinned: [pin("m1")] }));

    expect(screen.getByText("Spotkanie o dziesiątej")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Spotkanie/ })).not.toBeInTheDocument();
  });

  it("unpins from the list, naming whose message goes", async () => {
    const onUnpin = vi.fn();
    const onOpenPin = vi.fn();
    render(
      panel({ pinned: [pin("m1", { authorName: "Bartek" })], onUnpin, onOpenPin }),
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Odepnij wiadomość od Bartek" }));

    expect(onUnpin).toHaveBeenCalledExactlyOnceWith("m1");
    expect(onOpenPin).not.toHaveBeenCalled();
  });

  it("offers no unpin to someone who may not moderate", () => {
    render(panel({ pinned: [pin("m1")], onOpenPin: vi.fn() }));

    expect(screen.queryByRole("button", { name: /Odepnij/ })).not.toBeInTheDocument();
  });

  it("names a pin that has no words", () => {
    render(panel({ pinned: [pin("m1", { preview: "" })] }));

    expect(screen.getByText("Wiadomość bez tekstu")).toBeInTheDocument();
  });

  it("lists pins in the order given", () => {
    render(
      panel({
        pinned: [pin("m1", { preview: "Nowsza" }), pin("m2", { preview: "Starsza" })],
      }),
    );

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Nowsza"),
      expect.stringContaining("Starsza"),
    ]);
  });

  it("shows why a pin or unpin failed above the list", () => {
    render(panel({ pinned: [pin("m1")], pinError: "Brak uprawnień" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Brak uprawnień");
    expect(screen.getByText("Spotkanie o dziesiątej")).toBeInTheDocument();
  });
});

describe("ChannelPanel media", () => {
  it("opens the viewer on the clicked picture with every picture of the grid, in order", async () => {
    const onOpenImage = vi.fn();
    const video: MediaItemVM = {
      id: "v1",
      part: { kind: "video", name: "demo.mp4", url: "/media/v1.mp4" },
      ...origin,
    };
    const media = [photo("p1", "zachód"), video, photo("p2", "wschód")];
    render(panel({ tab: "media", media, callbacks: { onOpenImage } }));

    await userEvent.setup().click(screen.getByRole("button", { name: /^Powiększ: wschód/ }));

    expect(onOpenImage).toHaveBeenCalledExactlyOnceWith(
      [
        { src: "/media/p1.png", alt: "zachód" },
        { src: "/media/p2.png", alt: "wschód" },
      ],
      1,
    );
  });

  it("plays a clip from its tile and falls back to a generic name for an unnamed one", async () => {
    const onPlayVideo = vi.fn();
    const part = { kind: "video" as const, url: "/media/v1.mp4", duration: "0:12" };
    render(
      panel({
        tab: "media",
        media: [{ id: "v1", part, ...origin }],
        callbacks: { onPlayVideo },
      }),
    );

    const tile = screen.getByRole("button", { name: /^Odtwórz: nagranie/ });
    expect(tile).toHaveTextContent("0:12");
    await userEvent.setup().click(tile);

    expect(onPlayVideo).toHaveBeenCalledExactlyOnceWith(part);
  });

  it("lists files and voice notes under the grid as rows that download", () => {
    const media: MediaItemVM[] = [
      photo("p1", "zachód"),
      {
        id: "f1",
        part: { kind: "file", name: "raport.pdf", ext: "PDF", size: "2 MB", url: "/files/f1" },
        ...origin,
      },
      {
        id: "a1",
        part: { kind: "audio", name: "notatka.webm", duration: "0:19", url: "/files/a1" },
        ...origin,
      },
    ];
    render(panel({ tab: "media", media }));

    const file = screen.getByRole("link", { name: /raport\.pdf/ });
    expect(file).toHaveAttribute("href", "/files/f1");
    expect(file).toHaveAttribute("download", "raport.pdf");
    expect(file).toHaveTextContent("2 MB");
    const voice = screen.getByRole("link", { name: /notatka\.webm/ });
    expect(voice).toHaveTextContent("0:19");
    expect(screen.getByText("Pliki")).toBeInTheDocument();
  });

  it("lists a file that is still uploading without making it a link", () => {
    const media: MediaItemVM[] = [
      {
        id: "f1",
        part: { kind: "file", name: "raport.pdf", ext: "PDF", size: "2 MB" },
        ...origin,
      },
    ];
    render(panel({ tab: "media", media }));

    expect(screen.getByText("raport.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("has no files heading when there are only pictures", () => {
    render(panel({ tab: "media", media: [photo("p1", "zachód")] }));

    expect(screen.queryByText("Pliki")).not.toBeInTheDocument();
  });
});

describe("ChannelPanel links", () => {
  it("lists a link with its title, domain and author, opening in a new tab", () => {
    render(
      panel({
        tab: "links",
        links: [
          {
            id: "l1",
            href: "https://example.com/brief",
            title: "Brief",
            domain: "example.com",
            thumb: "/thumbs/l1.png",
            ...origin,
          },
          {
            id: "l2",
            href: "https://example.org/",
            title: "https://example.org/",
            domain: "example.org",
            ...origin,
          },
        ],
      }),
    );

    const brief = screen.getByRole("link", { name: /Brief/ });
    expect(brief).toHaveAttribute("href", "https://example.com/brief");
    expect(brief).toHaveAttribute("target", "_blank");
    expect(brief.getAttribute("rel")).toContain("noopener");
    expect(brief).toHaveTextContent("example.com");
    expect(brief).toHaveTextContent("Ada");
    expect(brief.querySelector("img")).toHaveAttribute("src", "/thumbs/l1.png");
    expect(screen.getByRole("link", { name: /example\.org/ }).querySelector("img")).toBeNull();
  });
});

describe("ChannelPanel empty states", () => {
  it("tells the search tab what can be searched for", () => {
    render(panel({ tab: "search" }));

    expect(
      screen.getByText("Szukaj w całej historii: wiadomościach, nazwach plików i linkach."),
    ).toBeInTheDocument();
  });

  it("says nothing is pinned, or that pins are loading", () => {
    const { rerender } = render(panel());
    expect(screen.getByText(/^Nikt jeszcze nic tu nie przypiął/)).toBeInTheDocument();

    rerender(panel({ pinnedLoading: true }));
    expect(screen.getByText("Wczytywanie przypiętych wiadomości…")).toBeInTheDocument();
  });

  it("says the channel has no media, or that it is loading", () => {
    const { rerender } = render(panel({ tab: "media" }));
    expect(
      screen.getByText("Na tym kanale nie ma jeszcze zdjęć ani nagrań."),
    ).toBeInTheDocument();

    rerender(panel({ tab: "media", indexLoading: true }));
    expect(screen.getByText("Wczytywanie…")).toBeInTheDocument();
    expect(
      screen.queryByText("Na tym kanale nie ma jeszcze zdjęć ani nagrań."),
    ).not.toBeInTheDocument();
  });

  it("says the channel has no links, or that it is loading", () => {
    const { rerender } = render(panel({ tab: "links" }));
    expect(screen.getByText("Nikt jeszcze nie wrzucił tu linku.")).toBeInTheDocument();

    rerender(panel({ tab: "links", indexLoading: true }));
    expect(screen.getByText("Wczytywanie…")).toBeInTheDocument();
    expect(screen.queryByText("Nikt jeszcze nie wrzucił tu linku.")).not.toBeInTheDocument();
  });

  it("keeps showing what it has while more of the index loads", () => {
    render(panel({ tab: "media", media: [photo("p1", "zachód")], indexLoading: true }));

    expect(screen.getByRole("button", { name: /^Powiększ: zachód/ })).toBeInTheDocument();
    expect(screen.queryByText("Wczytywanie…")).not.toBeInTheDocument();
  });
});

describe("ChannelPanel index paging", () => {
  it.each(["media", "links"] as const)(
    "reports a failed index on the %s tab instead of calling the channel empty",
    async (tab) => {
      const onRetryIndex = vi.fn();
      render(panel({ tab, indexError: "Indeks niedostępny", onRetryIndex }));

      expect(screen.getByRole("alert")).toHaveTextContent("Indeks niedostępny");
      expect(screen.queryByText(/nie ma jeszcze|Nikt jeszcze/)).not.toBeInTheDocument();

      await userEvent.setup().click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
      expect(onRetryIndex).toHaveBeenCalledOnce();
    },
  );

  it.each(["media", "links"] as const)(
    "loads an older page of the index from the %s tab",
    async (tab) => {
      const onLoadMoreIndex = vi.fn();
      render(panel({ tab, indexHasMore: true, onLoadMoreIndex }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Pokaż starsze wyniki" }));

      expect(onLoadMoreIndex).toHaveBeenCalledOnce();
    },
  );

  it("disables the older-page button while a page is on its way", () => {
    render(panel({ tab: "links", indexLoadingMore: true }));

    expect(screen.getByRole("button", { name: "Wczytywanie…" })).toBeDisabled();
  });

  it("does not offer the index's older pages on the pinned tab", () => {
    render(panel({ tab: "pinned", indexHasMore: true, indexError: "Indeks niedostępny" }));

    expect(screen.queryByRole("button", { name: "Pokaż starsze wyniki" })).not.toBeInTheDocument();
    expect(screen.queryByText("Indeks niedostępny")).not.toBeInTheDocument();
  });
});
