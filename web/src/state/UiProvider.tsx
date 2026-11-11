"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ChannelPanelTab } from "@/components/room/channelPanelModel";
import type { FriendsTab, RoomView } from "@/components/view-models";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { ChannelKind } from "@/ports";

import { useDirectoryContext } from "./DirectoryProvider";
import { useVoiceContext } from "./VoiceProvider";

/**
 * The dialog that is up. Only one can be, so this is a value rather than a set.
 *
 * `settings` is the server's and `account` is the person's own; `profile` and
 * `voice` are the account dialog opened on a particular pane.
 */
export type ModalKey =
  | "settings"
  | "account"
  | "profile"
  | "voice"
  | "invite"
  /** Creates a server, from the launcher at the bottom of the server rail. */
  | "server-create"
  /** Finds a public server, or joins one from an invite. */
  | "server-discover"
  /** Which client to install. */
  | "client"
  /** One channel's settings, raised by the cog on its rail row. */
  | "channel"
  /** A channel that does not exist yet, raised by the "+" beside a caption. */
  | "channel-new"
  /** One section's settings, raised by the cog on its rail header. */
  | "section"
  /** A section that does not exist yet. */
  | "section-new";

/**
 * Which half of the app is on screen. Not a route: both halves share the room,
 * the voice dock and the account row, and only the rail and the room's content
 * change.
 */
export type Space = "server" | "dm";

interface PanelsValue {
  railOpen: boolean;
  rosterOpen: boolean;
  setRailOpen: (open: boolean) => void;
  setRosterOpen: (open: boolean) => void;
  toggleRail: () => void;
  toggleRoster: () => void;
  closeDrawers: () => void;

  /** The transcript's side panel, or null while it is shut. */
  channelPanel: ChannelPanelTab | null;
  /** The tab the panel shows, or will show when it next opens. */
  channelPanelTab: ChannelPanelTab;
  toggleChannelPanel: (tab: ChannelPanelTab) => void;
  showChannelPanelTab: (tab: ChannelPanelTab) => void;
  closeChannelPanel: () => void;
}

interface DialogsValue {
  modal: ModalKey | null;
  openModal: (modal: ModalKey) => void;
  closeModal: () => void;
  /** The channel the "channel" dialog is about; kept after it closes so it can fade. */
  channelSettingsId: string | null;
  openChannelSettings: (channelId: string) => void;
  /** The kind of channel the "new channel" dialog offers to make. */
  newChannelKind: ChannelKind | null;
  openCreateChannel: (kind: ChannelKind) => void;
  /** The section the "section" dialog is about; kept after it closes so it can fade. */
  sectionSettingsId: string | null;
  openSectionSettings: (sectionId: string) => void;
  openCreateSection: () => void;
}

export interface UiValue extends PanelsValue, DialogsValue {
  roomView: RoomView;
  space: Space;
  /** The open conversation in DM space; null means the Friends view itself. */
  activeDmId: string | null;
  friendsTab: FriendsTab;
  setFriendsTab: (tab: FriendsTab) => void;
  /** Leaves the server for the Friends view. */
  openFriends: () => void;
  openDm: (id: string) => void;
  /** Back to the server rail and whatever channel it was last on. */
  openServer: () => void;
  /** The text channel the room returns to when a call ends. */
  activeTextChannelId: string | null;
  /** What the rail marks as current: the text channel, or the joined call. */
  activeChannelId: string | null;

  cinema: boolean;
  setCinema: (on: boolean) => void;
  toggleCinema: () => void;

  selectTextChannel: (channelId: string) => void;
  joinVoiceChannel: (channelId: string) => void;
  leaveCall: () => void;
  /** Back to the call's stage, from the dock's status row. */
  returnToChannel: () => void;
}

/**
 * The rail drawer, the roster and the channel panel.
 *
 * Below 1024px the roster is a drawer, and below 1280px so is the channel
 * panel; drawers share one mobile layer, so opening one dismisses the others.
 * Above those widths the panels are grid tracks that the person arranges and
 * that navigation must leave alone.
 */
function usePanels(): PanelsValue {
  const rosterIsDrawer = useMediaQuery("(max-width: 1023px)", false);
  const channelPanelIsDrawer = useMediaQuery("(max-width: 1279px)", false);
  const rosterFits = useMediaQuery("(min-width: 1440px)", true);

  const [railOpen, setRailState] = useState(false);
  /*
   * The wide roster holds "no preference yet" rather than an initial `true`: the
   * default depends on the viewport, which the server render does not have, and
   * guessing wrong is a hydration mismatch. The drawer has its own state so the
   * desktop preference does not ride along into a narrow window and greet it
   * with the panel already covering the room.
   */
  const [rosterPreference, setRosterPreference] = useState<boolean | null>(null);
  const [rosterDrawerOpen, setRosterDrawerOpen] = useState(false);
  const [channelPanel, setChannelPanel] = useState<ChannelPanelTab | null>(null);
  const [channelPanelTab, setChannelPanelTab] = useState<ChannelPanelTab>("pinned");

  const rosterOpen = rosterIsDrawer
    ? rosterDrawerOpen
    : (rosterPreference ?? rosterFits);

  const setRosterOpen = useCallback(
    (open: boolean) => {
      if (open && channelPanelIsDrawer) setChannelPanel(null);
      if (!rosterIsDrawer) {
        setRosterPreference(open);
        return;
      }
      if (open) setRailState(false);
      setRosterDrawerOpen(open);
    },
    [channelPanelIsDrawer, rosterIsDrawer],
  );

  const setRailOpen = useCallback(
    (open: boolean) => {
      if (open && rosterIsDrawer) setRosterDrawerOpen(false);
      if (open && channelPanelIsDrawer) setChannelPanel(null);
      setRailState(open);
    },
    [channelPanelIsDrawer, rosterIsDrawer],
  );

  const closeDrawers = useCallback(() => {
    setRailState(false);
    if (rosterIsDrawer) setRosterOpen(false);
    if (channelPanelIsDrawer) setChannelPanel(null);
  }, [channelPanelIsDrawer, rosterIsDrawer, setRosterOpen]);

  const toggleChannelPanel = useCallback(
    (tab: ChannelPanelTab) => {
      if (channelPanelIsDrawer) {
        // The roster is still a grid track between 1024 and 1279px, but it
        // has to make room for this drawer all the same.
        setRailState(false);
        setRosterOpen(false);
      }
      setChannelPanelTab(tab);
      setChannelPanel((current) => (current === tab ? null : tab));
    },
    [channelPanelIsDrawer, setRosterOpen],
  );

  const showChannelPanelTab = useCallback((tab: ChannelPanelTab) => {
    setChannelPanelTab(tab);
    setChannelPanel(tab);
  }, []);

  const closeChannelPanel = useCallback(() => setChannelPanel(null), []);
  const toggleRail = useCallback(() => setRailOpen(!railOpen), [setRailOpen, railOpen]);
  const toggleRoster = useCallback(() => setRosterOpen(!rosterOpen), [setRosterOpen, rosterOpen]);

  return useMemo(
    () => ({
      railOpen,
      rosterOpen,
      setRailOpen,
      setRosterOpen,
      toggleRail,
      toggleRoster,
      closeDrawers,
      channelPanel,
      channelPanelTab,
      toggleChannelPanel,
      showChannelPanelTab,
      closeChannelPanel,
    }),
    [
      railOpen,
      rosterOpen,
      setRailOpen,
      setRosterOpen,
      toggleRail,
      toggleRoster,
      closeDrawers,
      channelPanel,
      channelPanelTab,
      toggleChannelPanel,
      showChannelPanelTab,
      closeChannelPanel,
    ],
  );
}

function useDialogs(closeDrawers: () => void): DialogsValue {
  const [modal, setModal] = useState<ModalKey | null>(null);
  const [channelSettingsId, setChannelSettingsId] = useState<string | null>(null);
  const [newChannelKind, setNewChannelKind] = useState<ChannelKind | null>(null);
  const [sectionSettingsId, setSectionSettingsId] = useState<string | null>(null);

  const closeModal = useCallback(() => setModal(null), []);

  // A dialog owns the interaction layer: a drawer left armed underneath it
  // would reappear when the dialog is dismissed.
  const openModal = useCallback(
    (next: ModalKey) => {
      closeDrawers();
      setModal(next);
    },
    [closeDrawers],
  );

  const openChannelSettings = useCallback(
    (channelId: string) => {
      setChannelSettingsId(channelId);
      openModal("channel");
    },
    [openModal],
  );

  const openCreateChannel = useCallback(
    (kind: ChannelKind) => {
      setNewChannelKind(kind);
      openModal("channel-new");
    },
    [openModal],
  );

  const openSectionSettings = useCallback(
    (sectionId: string) => {
      setSectionSettingsId(sectionId);
      openModal("section");
    },
    [openModal],
  );

  const openCreateSection = useCallback(() => openModal("section-new"), [openModal]);

  return useMemo(
    () => ({
      modal,
      openModal,
      closeModal,
      channelSettingsId,
      openChannelSettings,
      newChannelKind,
      openCreateChannel,
      sectionSettingsId,
      openSectionSettings,
      openCreateSection,
    }),
    [
      modal,
      openModal,
      closeModal,
      channelSettingsId,
      openChannelSettings,
      newChannelKind,
      openCreateChannel,
      sectionSettingsId,
      openSectionSettings,
      openCreateSection,
    ],
  );
}

const UiContext = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const { firstTextChannelId } = useDirectoryContext();
  const voice = useVoiceContext();
  /*
   * The voice value changes with every speaking-level snapshot. Actions that
   * closed over it would change as often, and with them this whole value,
   * re-rendering every `useUi()` consumer while anybody talks. They read the
   * latest call through a ref instead; only the channel id is rendered.
   */
  const voiceRef = useRef(voice);
  useLayoutEffect(() => {
    voiceRef.current = voice;
  });
  const voiceChannelId = voice.channelId;

  const panels = usePanels();
  const { closeDrawers } = panels;
  const dialogs = useDialogs(closeDrawers);
  const { modal } = dialogs;

  const [roomView, setRoomView] = useState<RoomView>("text");
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [space, setSpace] = useState<Space>("server");
  const [activeDmId, setActiveDmId] = useState<string | null>(null);
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("online");
  const [cinema, setCinema] = useState(false);

  const activeTextChannelId = selectedTextId ?? firstTextChannelId;

  const toggleCinema = useCallback(() => setCinema((on) => !on), []);

  const selectTextChannel = useCallback(
    (channelId: string) => {
      setSelectedTextId(channelId);
      setRoomView("text");
      // The rail that raised this is the server's, so the room follows it there.
      setSpace("server");
      closeDrawers();
    },
    [closeDrawers],
  );

  const openFriends = useCallback(() => {
    setSpace("dm");
    setActiveDmId(null);
    closeDrawers();
  }, [closeDrawers]);

  const openDm = useCallback(
    (id: string) => {
      setSpace("dm");
      setActiveDmId(id);
      closeDrawers();
    },
    [closeDrawers],
  );

  const openServer = useCallback(() => {
    setSpace("server");
    closeDrawers();
  }, [closeDrawers]);

  const joinVoiceChannel = useCallback(
    (channelId: string) => {
      // The room follows the click; the dock follows the connection state, so
      // a join that fails leaves the stage up and says why.
      voiceRef.current.join(channelId);
      setRoomView("voice");
      setSpace("server");
      closeDrawers();
    },
    [closeDrawers],
  );

  const leaveCall = useCallback(() => {
    setCinema(false);
    void voiceRef.current.leave();
    setRoomView("text");
  }, []);

  // The dock shows in a conversation too, but the stage only exists on the
  // server side.
  const returnToChannel = useCallback(() => {
    setSpace("server");
    setRoomView("voice");
  }, []);

  /*
   * Escape unwinds in the order dialog, cinema, drawers. `Modal` closes itself
   * from its own `document` listener, so this one stands aside while a dialog
   * is up. The drawers listen on `window`, one hop further along, so stopping
   * propagation here is what keeps one press from closing them behind cinema.
   */
  useEffect(() => {
    if (!cinema || modal !== null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setCinema(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cinema, modal]);

  const value = useMemo<UiValue>(
    () => ({
      ...panels,
      ...dialogs,
      roomView,
      space,
      activeDmId,
      friendsTab,
      setFriendsTab,
      openFriends,
      openDm,
      openServer,
      activeTextChannelId,
      activeChannelId: roomView === "voice" ? voiceChannelId : activeTextChannelId,
      cinema,
      setCinema,
      toggleCinema,
      selectTextChannel,
      joinVoiceChannel,
      leaveCall,
      returnToChannel,
    }),
    [
      panels,
      dialogs,
      roomView,
      space,
      activeDmId,
      friendsTab,
      openFriends,
      openDm,
      openServer,
      activeTextChannelId,
      voiceChannelId,
      cinema,
      toggleCinema,
      selectTextChannel,
      joinVoiceChannel,
      leaveCall,
      returnToChannel,
    ],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUiContext(): UiValue {
  const value = useContext(UiContext);
  if (value === null) {
    throw new Error("useUi must be used inside <UiProvider>");
  }
  return value;
}
