import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";

import { ServerSettings, type ServerSettingsProps } from "./ServerSettings";

function props(overrides: Partial<ServerSettingsProps> = {}): ServerSettingsProps {
  return {
    open: true,
    onClose: vi.fn(),
    name: "Orbit",
    overview: {
      supported: true,
      iconSupported: true,
      name: "Orbit",
      mark: "OR",
      memberCount: 2,
      channelCount: 1,
      description: "",
      isPublic: false,
      onSave: vi.fn().mockResolvedValue(undefined),
      onPickIcon: vi.fn().mockResolvedValue(undefined),
      onRemoveIcon: vi.fn().mockResolvedValue(undefined),
    },
    channels: {
      supported: true,
      channels: [],
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      sectionsSupported: true,
      sections: [],
      onAddSection: vi.fn(),
      onEditSection: vi.fn(),
      onMoveSectionUp: vi.fn().mockResolvedValue(undefined),
      onMoveSectionDown: vi.fn().mockResolvedValue(undefined),
    },
    roles: {
      supported: true,
      roles: [],
      onCreate: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn().mockResolvedValue(undefined),
      onDelete: vi.fn().mockResolvedValue(undefined),
    },
    members: { supported: true, members: [], roles: [], onAssignRole: vi.fn().mockResolvedValue(undefined) },
    invites: {
      supported: true,
      invites: [],
      onCreate: vi.fn().mockResolvedValue(undefined),
      onRevoke: vi.fn().mockResolvedValue(undefined),
    },
    emoji: {
      supported: true,
      emoji: [],
      onUpload: vi.fn().mockResolvedValue(undefined),
      onDelete: vi.fn().mockResolvedValue(undefined),
    },
    soundboard: {
      supported: true,
      sounds: [],
      everyoneCanPlay: true,
      onEveryoneCanPlayChange: vi.fn(),
      rateLimited: true,
      onRateLimitedChange: vi.fn(),
      onCreate: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn().mockResolvedValue(undefined),
      playback: { outputVolume: 100, soundboardVolume: 100 },
      onSoundboardVolumeChange: vi.fn(),
    },
    audit: { supported: true, entries: [] },
    bans: { supported: true, bans: [], onUnban: vi.fn().mockResolvedValue(undefined) },
    danger: {
      supported: true,
      serverName: "Orbit",
      onTransfer: vi.fn().mockResolvedValue(undefined),
      onDelete: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function dialog(p: ServerSettingsProps) {
  return (
    <ConfirmProvider>
      <ServerSettings {...p} />
    </ConfirmProvider>
  );
}

/** What each pane shows once it is the one on screen, besides the bar. */
const PANES = [
  { item: "Przegląd", detail: "Nazwa, opis i widoczność serwera", marker: () => screen.getByRole("region", { name: "Profil serwera" }) },
  { item: "Kanały serwera", detail: "Kolejność i typy kanałów na serwerze", marker: () => screen.getByRole("region", { name: "Sekcje" }) },
  { item: "Role", detail: "Kto co może na tym serwerze", marker: () => screen.getByRole("region", { name: "Role" }) },
  { item: "Osoby na serwerze", detail: "Członkowie serwera i ich role", marker: () => screen.getByRole("region", { name: "Osoby na serwerze" }) },
  { item: "Zaproszenia", detail: "Aktywne linki i ich limity", marker: () => screen.getByRole("region", { name: "Zaproszenia" }) },
  { item: "Emoji", detail: "Emoji dostępne dla wszystkich na serwerze", marker: () => screen.getByText("Jeszcze nie ma własnych emoji") },
  { item: "Soundboard", detail: "Dźwięki dostępne na kanałach głosowych", marker: () => screen.getByText("Nie ma jeszcze żadnych dźwięków") },
  { item: "Dziennik zdarzeń", detail: "Kto co zmienił na serwerze", marker: () => screen.getByText("Ostatnie 30 dni") },
  { item: "Bany", detail: "Osoby, które nie mogą wrócić na serwer", marker: () => screen.getByText("Lista banów (0)") },
  { item: "Strefa zagrożenia", detail: "Operacje, których nie da się cofnąć", marker: () => screen.getByRole("region", { name: "Strefa zagrożenia" }) },
];

afterEach(() => vi.restoreAllMocks());

describe("ServerSettings navigation", () => {
  it("lists three captioned groups in order", () => {
    render(dialog(props()));

    const nav = screen.getByRole("navigation", { name: "Sekcje ustawień" });
    expect(Array.from(nav.children, (child) => child.textContent)).toEqual([
      "Ogólne",
      "Przegląd",
      "Zarządzanie",
      "Kanały serwera",
      "Role",
      "Osoby na serwerze",
      "Zaproszenia",
      "Emoji",
      "Soundboard",
      "Moderacja",
      "Dziennik zdarzeń",
      "Bany",
      "Strefa zagrożenia",
    ]);
  });

  it("is named after the server and opens on the overview", () => {
    render(dialog(props()));

    expect(screen.getByRole("dialog", { name: "Orbit" })).toBeVisible();
    expect(screen.getByText("Ustawienia serwera")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Przegląd" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Przegląd" })).toHaveAttribute("aria-current", "page");
  });

  it.each(PANES)("shows the $item pane with its title and detail line", async ({ item, detail, marker }) => {
    const user = userEvent.setup();
    render(dialog(props()));

    await user.click(screen.getByRole("button", { name: item }));

    expect(screen.getByRole("heading", { level: 2, name: item })).toBeVisible();
    expect(screen.getByText(detail)).toBeVisible();
    expect(marker()).toBeVisible();
    expect(screen.getByRole("button", { name: item })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("button", { current: "page" })).toHaveLength(1);
  });

  it("mounts only the chosen pane", async () => {
    const user = userEvent.setup();
    render(dialog(props()));
    expect(screen.getByRole("region", { name: "Profil serwera" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Bany" }));

    expect(screen.queryByRole("region", { name: "Profil serwera" })).toBeNull();
  });

  it("marks only the danger item as dangerous", () => {
    render(dialog(props()));

    const nav = screen.getByRole("navigation", { name: "Sekcje ustawień" });
    const marked = within(nav)
      .getAllByRole("button")
      .filter((button) => button.classList.contains("danger"));
    expect(marked.map((button) => button.textContent)).toEqual(["Strefa zagrożenia"]);
  });

  it("hands each pane the props it was given", async () => {
    const user = userEvent.setup();
    const p = props();
    render(dialog(p));

    await user.click(screen.getByRole("button", { name: "Strefa zagrożenia" }));
    await user.click(screen.getByRole("button", { name: "Usuń Orbit" }));

    expect(p.danger.onDelete).toHaveBeenCalledOnce();
  });

  it("starts the next pane at the top of the scroll area", async () => {
    const user = userEvent.setup();
    render(dialog(props()));
    const panes = document.querySelector('section[data-pane="prz"]')!.parentElement!;
    panes.scrollTop = 240;

    await user.click(screen.getByRole("button", { name: "Role" }));

    expect(panes.scrollTop).toBe(0);
  });

  it("brings the chosen item into view in the horizontal navigation", async () => {
    const user = userEvent.setup();
    const reveal = vi.spyOn(Element.prototype, "scrollIntoView");
    render(dialog(props()));

    const target = screen.getByRole("button", { name: "Zaproszenia" });
    await user.click(target);

    await waitFor(() => expect(reveal.mock.contexts.at(-1)).toBe(target));
  });
});

describe("ServerSettings dialog", () => {
  it("renders nothing while closed", () => {
    render(dialog(props({ open: false })));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from the close button and from Escape", async () => {
    const user = userEvent.setup();
    const p = props();
    render(dialog(p));

    await user.click(screen.getByRole("button", { name: "Zamknij ustawienia serwera" }));
    await user.keyboard("{Escape}");

    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it("starts on the overview again when it is reopened", async () => {
    const user = userEvent.setup();
    const p = props();
    const { rerender } = render(dialog(p));
    await user.click(screen.getByRole("button", { name: "Bany" }));

    rerender(dialog({ ...p, open: false }));
    rerender(dialog({ ...p, open: true }));

    expect(screen.getByRole("heading", { name: "Przegląd" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Przegląd" })).toHaveAttribute("aria-current", "page");
  });
});
