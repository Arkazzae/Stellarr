"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/icons/Icon";
import type { RoomView } from "@/components/view-models";
import { type Translator } from "@/i18n";
import { translateForDocument } from "@/i18n/defaultLocale";

export interface RoomHeaderProps {
  /** Text or voice: decides the glyph, and the CSS hides the channel tools. */
  view: RoomView;
  title: string;
  /** Empty in voice, where the stage says what is going on. */
  topic?: string;
  rosterOpen: boolean;
  onToggleRoster: () => void;
  /** The burger only exists below 768, where the rail is a drawer. */
  railOpen: boolean;
  onToggleRail: () => void;
  /** Whether the single channel-materials sidebar is currently visible. */
  panelOpen: boolean;
  /** Opens or shuts the panel on whichever list it was last showing. */
  onTogglePanel: () => void;
  /** The signed-in user's native, private inbox trigger. */
  notifications?: ReactNode;
  t?: Translator;
}

export function RoomHeader({
  view,
  title,
  topic = "",
  rosterOpen,
  onToggleRoster,
  railOpen,
  onToggleRail,
  panelOpen,
  onTogglePanel,
  notifications,
  t = translateForDocument,
}: RoomHeaderProps) {
  return (
    <header className="room-header">
      <button
        type="button"
        className="burger"
        aria-label={t("room.showChannels")}
        aria-expanded={railOpen}
        onClick={onToggleRail}
      >
        <Icon name="list" size={18} />
      </button>
      <span className="glyph" aria-hidden="true">
        <Icon name={view === "voice" ? "speaker" : "hash"} size={18} />
      </span>
      <h2>{title}</h2>
      <span className="topic">{topic}</span>
      <div className="pill-bar" role="toolbar" aria-label={t("room.channelTools")}>
        {notifications}
        <span className="tools-slot">
          <button
            type="button"
            className="pill-btn"
            title={t("room.channelPanel")}
            aria-label={t("room.channelPanel")}
            aria-pressed={panelOpen}
            onClick={onTogglePanel}
          >
            <Icon name="channelPanel" size={16} />
          </button>
        </span>
        {/* The id is load-bearing: the CSS selects `#rosterBtn` to show this
            button only where the roster is a drawer. */}
        <button
          type="button"
          className="pill-btn accent"
          id="rosterBtn"
          aria-pressed={rosterOpen}
          title={t("room.people")}
          aria-label={t("room.showPeople")}
          onClick={onToggleRoster}
        >
          <Icon name="users" size={16} />
        </button>
      </div>
    </header>
  );
}
