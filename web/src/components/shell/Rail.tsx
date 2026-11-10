"use client";

import { useId, useState, type MouseEvent, type ReactNode } from "react";

import { Icon } from "@/components/icons/Icon";
import { useContextMenu } from "@/components/primitives/ContextMenu";
import { UserMenu, type UserMenuActions } from "@/components/roster/UserMenu";
import {
  ChannelMenu,
  type ChannelMenuActions,
} from "@/components/shell/ChannelMenu";
import { CollapsibleGroup } from "@/components/shell/CollapsibleGroup";
import { RailHeader } from "@/components/shell/RailHeader";
import { RailSection } from "@/components/shell/RailSection";
import { RailTextList } from "@/components/shell/RailTextList";
import { RailVoiceList } from "@/components/shell/RailVoiceList";
import type {
  ChannelMenuRaiser,
  ChannelMenuTarget,
  RailThreads,
} from "@/components/shell/railTypes";
import { useThreadFocus } from "@/components/shell/useThreadFocus";
import { useVoiceMove } from "@/components/shell/useVoiceMove";
import type {
  ChannelThreadVM,
  PersonVM,
  SectionVM,
  TextChannelVM,
  VoiceChannelVM,
} from "@/components/view-models";
import { useLanguage } from "@/state/hooks";

export { voiceMoveRequest } from "@/components/shell/voiceMove";

export interface RailProps {
  serverName: string;
  /** Whether the servers / DM column is open; the button reports it. */
  serversOpen: boolean;
  onToggleServers: () => void;
  textChannels: TextChannelVM[];
  /** Complete thread lists keyed by their text channel. */
  threadsByChannel?: Readonly<Record<string, ChannelThreadVM[]>>;
  activeThreadId?: string | null;
  openingThreadId?: string | null;
  onOpenThread?: (thread: ChannelThreadVM) => void;
  voiceChannels: VoiceChannelVM[];
  /** Collapsible rail groups, in display order. Empty until any exist. */
  sections?: SectionVM[];
  /** The channel the room is showing — text or voice, only one is current. */
  activeChannelId: string | null;
  /** Whose occupant row gets `.me`. */
  selfId: string;
  /**
   * Whether this person may edit the channels: it decides the cog on each row
   * and the "+" beside each caption. The rail renders what it is told; who is
   * allowed is a question for whoever knows about roles.
   */
  canManageChannels?: boolean;
  /** Whether at least one server-settings pane is available to this member. */
  canAccessServerSettings?: boolean;
  /** Invites and server-wide administration require ManageServer. */
  canManageServer?: boolean;
  onSelectTextChannel: (id: string) => void;
  onJoinVoiceChannel: (id: string) => void;
  onEditServer: () => void;
  onInvite: () => void;
  /**
   * Dragging inside one rail group — a section's text list, or the
   * unsectioned bucket. `newGroupOrder` is that group's complete, freshly
   * ordered id list; every channel outside it keeps its own position.
   */
  onReorderChannelGroup: (newGroupOrder: string[]) => Promise<void> | void;
  onOpenChannelSettings?: (id: string) => void;
  onCreateChannel?: (kind: "text" | "voice") => void;
  /**
   * A section's cog. Sections are created from server settings, not the rail:
   * the "+" beside a caption makes a channel, and a second "+" for a whole
   * rail group would read as one control too many for something used far less
   * often.
   */
  onOpenSectionSettings?: (sectionId: string) => void;
  /**
   * Right-click on a channel row. Absent leaves the browser's own menu alone;
   * what the menu offers is decided by which of its actions are given.
   */
  channelMenu?: ChannelMenuActions;
  /** Right-click actions for a person seated under a voice channel. */
  voiceMemberMenu?: UserMenuActions;
  /** Staff-only move; dropping on the source channel is ignored. */
  onMoveVoiceMember?: (
    userId: string,
    sourceChannelId: string,
    targetChannelId: string,
  ) => Promise<void> | void;
  /** `<VoiceDock>`, composed by the container. */
  voiceDock?: ReactNode;
  /** `<AccountRow>`, composed by the container. */
  account?: ReactNode;
  /**
   * Below 768 the rail is an off-screen drawer while shut. Off screen must
   * also mean out of the tab order and off the accessibility tree, the same
   * way the roster handles it.
   */
  hidden?: boolean;
}

/** Whichever menu is open: one for the whole rail, never one per row. */
type RailMenu =
  | { type: "channel"; channel: ChannelMenuTarget }
  | { type: "person"; person: PersonVM };

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function CreateChannelButton({
  label,
  onCreate,
}: {
  label: string;
  onCreate: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      className="rail-add"
      title={t("shell.createChannel")}
      aria-label={label}
      onClick={onCreate}
    >
      <Icon name="plus" size={14} />
    </button>
  );
}

export function Rail({
  serverName,
  serversOpen,
  onToggleServers,
  textChannels,
  threadsByChannel = {},
  activeThreadId = null,
  openingThreadId = null,
  onOpenThread,
  voiceChannels,
  sections = [],
  activeChannelId,
  selfId,
  canManageChannels = false,
  canAccessServerSettings = false,
  canManageServer = false,
  onSelectTextChannel,
  onJoinVoiceChannel,
  onEditServer,
  onInvite,
  onReorderChannelGroup,
  onOpenChannelSettings,
  onCreateChannel,
  onOpenSectionSettings,
  channelMenu,
  voiceMemberMenu,
  onMoveVoiceMember,
  voiceDock,
  account,
  hidden = false,
}: RailProps) {
  const { t } = useLanguage();
  const railId = useId();
  const [textOpen, setTextOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(true);
  // Sections default open; tracking the closed ones means a freshly created
  // section needs no seeding to already look expanded.
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expandedThreads, setExpandedThreads] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [moveError, setMoveError] = useState<string | null>(null);
  const move = useVoiceMove({
    onMove: onMoveVoiceMember,
    onError: setMoveError,
  });

  /*
   * `useContextMenu` holds where the pointer was; which row it was over is
   * something it cannot know, so the target travels alongside it. Both are
   * facts about the event that raised the menu — reading the row back when an
   * item runs would give whatever the list looks like by then.
   */
  const ctx = useContextMenu();
  const [menu, setMenu] = useState<RailMenu | null>(null);

  const raiseChannelMenu: ChannelMenuRaiser | undefined =
    channelMenu === undefined
      ? undefined
      : (channel) => (event: MouseEvent<HTMLElement>) => {
          setMenu({ type: "channel", channel });
          ctx.onContextMenu(event);
        };
  const raisePersonMenu =
    voiceMemberMenu === undefined
      ? undefined
      : (person: PersonVM) => (event: MouseEvent<HTMLElement>) => {
          setMenu({ type: "person", person });
          ctx.onContextMenu(event);
        };

  const reorderGroup = async (order: string[]) => {
    setMoveError(null);
    try {
      await onReorderChannelGroup(order);
    } catch {
      setMoveError(t("rail.reorderFailed"));
    }
  };

  const registerThread = useThreadFocus(threadsByChannel, activeThreadId, hidden);
  const threads: RailThreads = {
    byChannel: threadsByChannel,
    activeId: activeThreadId,
    openingId: openingThreadId,
    expanded: expandedThreads,
    onToggle: (channelId) =>
      setExpandedThreads((current) => toggled(current, channelId)),
    onOpen: onOpenThread,
    register: registerThread,
  };
  const openSettings = canManageChannels ? onOpenChannelSettings : undefined;

  const textList = (channels: TextChannelVM[]) => (
    <RailTextList
      channels={channels}
      activeChannelId={activeChannelId}
      threads={threads}
      isMuted={channelMenu?.isMuted}
      onSelect={onSelectTextChannel}
      onOpenSettings={openSettings}
      menuFor={raiseChannelMenu}
      onReorder={(order) => void reorderGroup(order)}
    />
  );
  const voiceList = (channels: VoiceChannelVM[]) => (
    <RailVoiceList
      channels={channels}
      activeChannelId={activeChannelId}
      selfId={selfId}
      move={move}
      canMove={onMoveVoiceMember !== undefined}
      onJoin={onJoinVoiceChannel}
      onOpenSettings={openSettings}
      menuFor={raiseChannelMenu}
      personMenuFor={raisePersonMenu}
    />
  );

  const createAction = (kind: "text" | "voice") =>
    canManageChannels && onCreateChannel !== undefined ? (
      <CreateChannelButton
        label={t(
          kind === "text"
            ? "shell.createTextChannel"
            : "shell.createVoiceChannel",
        )}
        onCreate={() => onCreateChannel(kind)}
      />
    ) : null;

  let openMenu: ReactNode = null;
  if (ctx.at !== null && menu?.type === "channel" && channelMenu !== undefined) {
    openMenu = (
      <ChannelMenu
        {...channelMenu}
        at={ctx.at}
        channelId={menu.channel.id}
        kind={menu.channel.kind}
        name={menu.channel.name}
        unread={menu.channel.unread}
        currentSectionId={menu.channel.sectionId}
        onClose={ctx.close}
      />
    );
  } else if (
    ctx.at !== null &&
    menu?.type === "person" &&
    voiceMemberMenu !== undefined
  ) {
    openMenu = (
      <UserMenu
        {...voiceMemberMenu}
        at={ctx.at}
        userId={menu.person.id}
        displayName={menu.person.displayName}
        self={menu.person.id === selfId}
        anchor={ctx.anchor}
        onClose={ctx.close}
      />
    );
  }

  return (
    <nav
      className="rail"
      aria-label={t("shell.serverAndChannels")}
      // `inert` already removes a closed drawer from focus navigation and the
      // accessibility tree. Adding `aria-hidden` as well races with focus
      // transfer when a channel click closes the drawer, which Chromium
      // correctly reports as hiding the currently focused control.
      inert={hidden}
    >
      <RailHeader
        serverName={serverName}
        serversOpen={serversOpen}
        onToggleServers={onToggleServers}
        onEditServer={canAccessServerSettings ? onEditServer : undefined}
        onInvite={canManageServer ? onInvite : undefined}
      />

      <div className="rail-scroll">
        <CollapsibleGroup
          id={`${railId}-text`}
          caption={t("shell.textChannels")}
          captionTitle={t("shell.dragChannel")}
          open={textOpen}
          onToggle={() => setTextOpen((open) => !open)}
          actions={createAction("text")}
        >
          {textList(textChannels.filter((channel) => channel.sectionId === undefined))}
        </CollapsibleGroup>
        <CollapsibleGroup
          id={`${railId}-voice`}
          caption={t("shell.voiceChannels")}
          open={voiceOpen}
          onToggle={() => setVoiceOpen((open) => !open)}
          actions={createAction("voice")}
        >
          {voiceList(voiceChannels.filter((channel) => channel.sectionId === undefined))}
        </CollapsibleGroup>

        {sections.map((section) => {
          const sectionText = textChannels.filter(
            (channel) => channel.sectionId === section.id,
          );
          const sectionVoice = voiceChannels.filter(
            (channel) => channel.sectionId === section.id,
          );
          return (
            <RailSection
              key={section.id}
              name={section.name}
              open={!closedSections.has(section.id)}
              onToggle={() =>
                setClosedSections((current) => toggled(current, section.id))
              }
              empty={sectionText.length === 0 && sectionVoice.length === 0}
              onOpenSettings={
                canManageChannels && onOpenSectionSettings !== undefined
                  ? () => onOpenSectionSettings(section.id)
                  : undefined
              }
            >
              {sectionText.length === 0 ? null : textList(sectionText)}
              {sectionVoice.length === 0 ? null : voiceList(sectionVoice)}
            </RailSection>
          );
        })}

        {moveError === null ? null : (
          <p className="rail-move-error" role="alert">
            {moveError}
          </p>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {move.announcement}
      </span>

      {/* Rendered from the rail rather than from the row, so the menu outlives
          a list that reorders under it and there is only ever one open. */}
      {openMenu}

      {voiceDock}
      {account}
    </nav>
  );
}
