import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UiProvider, useUiContext } from "./UiProvider";

const harness = vi.hoisted(() => ({
  firstTextChannelId: "ch-general" as string | null,
  voice: {
    channelId: null as string | null,
    join: vi.fn(),
    leave: vi.fn(async () => {}),
  },
}));

vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => ({ firstTextChannelId: harness.firstTextChannelId }),
}));

vi.mock("./VoiceProvider", () => ({
  useVoiceContext: () => harness.voice,
}));

const DESKTOP = 1500;
const LAPTOP = 1100;
const PHONE = 800;
const originalWidth = window.innerWidth;

function mountUi(width = DESKTOP) {
  window.innerWidth = width;
  return renderHook(() => useUiContext(), { wrapper: UiProvider });
}

beforeEach(() => {
  harness.firstTextChannelId = "ch-general";
  harness.voice = { channelId: null, join: vi.fn(), leave: vi.fn(async () => {}) };
});

afterEach(() => {
  window.innerWidth = originalWidth;
});

describe("UiProvider navigation", () => {
  it("starts on the first text channel of the server", () => {
    const { result } = mountUi();

    expect(result.current).toMatchObject({
      space: "server",
      roomView: "text",
      activeTextChannelId: "ch-general",
      activeChannelId: "ch-general",
    });
  });

  it("selectTextChannel shows that channel's text and leaves the stage", () => {
    const { result } = mountUi();
    act(() => result.current.joinVoiceChannel("ch-salon"));

    act(() => result.current.selectTextChannel("ch-random"));

    expect(result.current).toMatchObject({
      roomView: "text",
      space: "server",
      activeTextChannelId: "ch-random",
    });
  });

  it("selectTextChannel brings the room back from a conversation", () => {
    const { result } = mountUi();
    act(() => result.current.openDm("dm-1"));
    expect(result.current).toMatchObject({ space: "dm", activeDmId: "dm-1" });

    act(() => result.current.selectTextChannel("ch-general"));

    expect(result.current.space).toBe("server");
  });

  it("joinVoiceChannel joins the call and shows the voice view on the server side", () => {
    const { result } = mountUi();
    act(() => result.current.openFriends());

    act(() => result.current.joinVoiceChannel("ch-salon"));

    expect(harness.voice.join).toHaveBeenCalledExactlyOnceWith("ch-salon");
    expect(result.current).toMatchObject({ roomView: "voice", space: "server" });
  });

  it("marks the joined call as the current channel while the voice view is up", () => {
    const { result, rerender } = mountUi();
    act(() => result.current.joinVoiceChannel("ch-salon"));
    harness.voice = { ...harness.voice, channelId: "ch-salon" };
    rerender();

    expect(result.current.activeChannelId).toBe("ch-salon");
    expect(result.current.activeTextChannelId).toBe("ch-general");
  });

  it("leaveCall ends the call and returns to the last text channel", () => {
    const { result } = mountUi();
    act(() => result.current.selectTextChannel("ch-random"));
    act(() => result.current.joinVoiceChannel("ch-salon"));
    act(() => result.current.setCinema(true));

    act(() => result.current.leaveCall());

    expect(harness.voice.leave).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({
      roomView: "text",
      cinema: false,
      activeTextChannelId: "ch-random",
    });
  });

  it("returnToChannel goes back to the stage from a conversation", () => {
    const { result } = mountUi();
    act(() => result.current.openDm("dm-1"));

    act(() => result.current.returnToChannel());

    expect(result.current).toMatchObject({ space: "server", roomView: "voice" });
  });

  it("opens the Friends view and a conversation, and goes back to the server", () => {
    const { result } = mountUi();

    act(() => result.current.openDm("dm-1"));
    expect(result.current).toMatchObject({ space: "dm", activeDmId: "dm-1" });

    act(() => result.current.openFriends());
    expect(result.current).toMatchObject({ space: "dm", activeDmId: null });

    act(() => result.current.openServer());
    expect(result.current.space).toBe("server");
  });

  it("keeps its value when only the voice object changes, and calls the newest join", () => {
    const { result, rerender } = mountUi();
    const before = result.current;
    const newerJoin = vi.fn();

    harness.voice = { ...harness.voice, join: newerJoin };
    rerender();

    expect(result.current).toBe(before);
    act(() => result.current.joinVoiceChannel("ch-salon"));
    expect(newerJoin).toHaveBeenCalledExactlyOnceWith("ch-salon");
  });
});

describe("UiProvider drawers", () => {
  it("shows the roster by default only where it fits beside the room", () => {
    expect(mountUi(DESKTOP).result.current.rosterOpen).toBe(true);
    expect(mountUi(LAPTOP).result.current.rosterOpen).toBe(false);
    expect(mountUi(PHONE).result.current.rosterOpen).toBe(false);
  });

  it("remembers the person's choice for the wide roster", () => {
    const { result } = mountUi(DESKTOP);

    act(() => result.current.toggleRoster());

    expect(result.current.rosterOpen).toBe(false);
  });

  it("closes the rail, the roster and the channel panel when a channel is picked on a phone", () => {
    const { result } = mountUi(PHONE);

    act(() => result.current.setRailOpen(true));
    act(() => result.current.selectTextChannel("ch-random"));
    expect(result.current.railOpen).toBe(false);

    act(() => result.current.setRosterOpen(true));
    expect(result.current.rosterOpen).toBe(true);
    act(() => result.current.selectTextChannel("ch-general"));
    expect(result.current.rosterOpen).toBe(false);

    act(() => result.current.toggleChannelPanel("media"));
    expect(result.current.channelPanel).toBe("media");
    act(() => result.current.selectTextChannel("ch-random"));
    expect(result.current.channelPanel).toBeNull();
  });

  it("leaves a roster and a channel panel that sit beside the room on desktop", () => {
    const { result } = mountUi(DESKTOP);
    act(() => result.current.toggleChannelPanel("search"));
    act(() => result.current.setRailOpen(true));

    act(() => result.current.selectTextChannel("ch-random"));

    expect(result.current).toMatchObject({
      railOpen: false,
      rosterOpen: true,
      channelPanel: "search",
    });
  });

  it("closes only the channel panel between 1024 and 1279px, where the roster is a column", () => {
    const { result } = mountUi(LAPTOP);
    act(() => result.current.setRosterOpen(true));
    act(() => result.current.toggleChannelPanel("links"));
    expect(result.current).toMatchObject({ rosterOpen: false, channelPanel: "links" });

    act(() => result.current.setRosterOpen(true));
    expect(result.current).toMatchObject({ rosterOpen: true, channelPanel: null });

    act(() => result.current.showChannelPanelTab("links"));
    act(() => result.current.selectTextChannel("ch-random"));
    expect(result.current).toMatchObject({ rosterOpen: true, channelPanel: null });
  });

  it("makes the rail and the roster drawers exclusive on a phone", () => {
    const { result } = mountUi(PHONE);

    act(() => result.current.setRosterOpen(true));
    act(() => result.current.setRailOpen(true));
    expect(result.current).toMatchObject({ railOpen: true, rosterOpen: false });

    act(() => result.current.toggleRoster());
    expect(result.current).toMatchObject({ railOpen: false, rosterOpen: true });
  });

  it("toggles the servers column independently of the drawers", () => {
    const { result } = mountUi(PHONE);

    act(() => result.current.toggleServers());
    act(() => result.current.closeDrawers());

    expect(result.current.serversOpen).toBe(true);
  });
});

describe("UiProvider channel panel", () => {
  it("toggles per tab: the same tab closes the panel, another tab switches to it", () => {
    const { result } = mountUi();

    act(() => result.current.toggleChannelPanel("pinned"));
    expect(result.current).toMatchObject({ channelPanel: "pinned", channelPanelTab: "pinned" });

    act(() => result.current.toggleChannelPanel("media"));
    expect(result.current).toMatchObject({ channelPanel: "media", channelPanelTab: "media" });

    act(() => result.current.toggleChannelPanel("media"));
    expect(result.current.channelPanel).toBeNull();
  });

  it("remembers the tab it last showed after the panel closes", () => {
    const { result } = mountUi();
    act(() => result.current.showChannelPanelTab("links"));
    expect(result.current.channelPanel).toBe("links");

    act(() => result.current.closeChannelPanel());

    expect(result.current).toMatchObject({ channelPanel: null, channelPanelTab: "links" });
  });
});

describe("UiProvider dialogs", () => {
  it("opens one dialog at a time and closes it", () => {
    const { result } = mountUi();

    act(() => result.current.openModal("account"));
    expect(result.current.modal).toBe("account");

    act(() => result.current.openModal("invite"));
    expect(result.current.modal).toBe("invite");

    act(() => result.current.closeModal());
    expect(result.current.modal).toBeNull();
  });

  it("dismisses an open drawer rather than leaving it armed under the dialog", () => {
    const { result } = mountUi(PHONE);
    act(() => result.current.setRailOpen(true));

    act(() => result.current.openModal("settings"));

    expect(result.current).toMatchObject({ modal: "settings", railOpen: false });
  });

  it("keeps the channel id after its dialog closes so the dialog can fade", () => {
    const { result } = mountUi();

    act(() => result.current.openChannelSettings("ch-random"));
    expect(result.current).toMatchObject({ modal: "channel", channelSettingsId: "ch-random" });

    act(() => result.current.closeModal());
    expect(result.current).toMatchObject({ modal: null, channelSettingsId: "ch-random" });
  });

  it("keeps the section id and the new channel kind the same way", () => {
    const { result } = mountUi();

    act(() => result.current.openSectionSettings("sec-1"));
    expect(result.current).toMatchObject({ modal: "section", sectionSettingsId: "sec-1" });
    act(() => result.current.closeModal());

    act(() => result.current.openCreateChannel("voice"));
    expect(result.current).toMatchObject({ modal: "channel-new", newChannelKind: "voice" });
    act(() => result.current.closeModal());

    act(() => result.current.openCreateSection());
    expect(result.current.modal).toBe("section-new");
    act(() => result.current.closeModal());

    expect(result.current).toMatchObject({
      sectionSettingsId: "sec-1",
      newChannelKind: "voice",
    });
  });
});

describe("UiProvider cinema", () => {
  it("toggles, and Escape leaves it without reaching the drawers' listener", () => {
    const { result } = mountUi();
    const drawers = vi.fn();
    window.addEventListener("keydown", drawers);
    act(() => result.current.toggleCinema());
    expect(result.current.cinema).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(result.current.cinema).toBe(false);
    expect(drawers).not.toHaveBeenCalled();
    window.removeEventListener("keydown", drawers);
  });

  it("leaves Escape to the dialog while one is up", () => {
    const { result } = mountUi();
    act(() => result.current.setCinema(true));
    act(() => result.current.openModal("settings"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(result.current.cinema).toBe(true);
  });
});
