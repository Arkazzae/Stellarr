"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Modal } from "@/components/primitives/Modal";
import { AuditPane, type AuditPaneProps } from "@/components/settings/panes/AuditPane";
import { BansPane, type BansPaneProps } from "@/components/settings/panes/BansPane";
import { ChannelsPane, type ChannelsPaneProps } from "@/components/settings/panes/ChannelsPane";
import { DangerPane, type DangerPaneProps } from "@/components/settings/panes/DangerPane";
import { EmojiPane, type EmojiPaneProps } from "@/components/settings/panes/EmojiPane";
import { InvitesPane, type InvitesPaneProps } from "@/components/settings/panes/InvitesPane";
import { MembersPane, type MembersPaneProps } from "@/components/settings/panes/MembersPane";
import { OverviewPane, type OverviewPaneProps } from "@/components/settings/panes/OverviewPane";
import { RolesPane, type RolesPaneProps } from "@/components/settings/panes/RolesPane";
import { SoundboardPane, type SoundboardPaneProps } from "@/components/settings/panes/SoundboardPane";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/hooks";

/** The mockup's `data-pane` keys, kept verbatim so the DOM stays comparable. */
export type SettingsPaneKey =
  | "prz"
  | "kan"
  | "role"
  | "ludzie"
  | "zapr"
  | "emoji"
  | "board"
  | "audyt"
  | "bany"
  | "danger";

interface NavItem {
  label: MessageKey;
  icon: IconName;
  /** The sentence under the title in the bar. */
  detail: MessageKey;
  danger?: true;
}

/** One table feeds both the navigation and the bar's title, so they cannot disagree. */
const ITEMS: Record<SettingsPaneKey, NavItem> = {
  prz: { label: "server.overview", icon: "server", detail: "server.overviewDetail" },
  kan: { label: "server.channels", icon: "hash2", detail: "server.channelsDetail" },
  role: { label: "server.roles", icon: "shield", detail: "server.rolesDetail" },
  ludzie: { label: "server.members", icon: "users", detail: "server.membersDetail" },
  zapr: { label: "server.invites", icon: "link", detail: "server.invitesDetail" },
  emoji: { label: "server.emoji", icon: "smiley", detail: "server.emojiDetail" },
  board: { label: "server.soundboard", icon: "board", detail: "server.soundboardDetail" },
  audyt: { label: "server.audit", icon: "clipboard", detail: "server.auditDetail" },
  bany: { label: "server.bans", icon: "ban", detail: "server.bansDetail" },
  danger: { label: "server.danger", icon: "trash", detail: "server.dangerDetail", danger: true },
};

const GROUPS: readonly { caption: MessageKey; panes: readonly SettingsPaneKey[] }[] = [
  { caption: "server.general", panes: ["prz"] },
  { caption: "server.management", panes: ["kan", "role", "ludzie", "zapr", "emoji", "board"] },
  { caption: "server.moderation", panes: ["audyt", "bany", "danger"] },
];

export interface ServerSettingsProps {
  open: boolean;
  onClose: () => void;
  /** Server name, in the sidebar brand and as the dialog's accessible name. */
  name: string;
  overview: OverviewPaneProps;
  channels: ChannelsPaneProps;
  roles: RolesPaneProps;
  members: MembersPaneProps;
  invites: InvitesPaneProps;
  emoji: EmojiPaneProps;
  soundboard: SoundboardPaneProps;
  audit: AuditPaneProps;
  bans: BansPaneProps;
  danger: DangerPaneProps;
}

/** The full-screen `.sv-wrap` settings dialog. */
export function ServerSettings({ open, onClose, ...content }: ServerSettingsProps) {
  const titleId = useId();

  // The modal mounts its children only while it is open, so the layout below
  // starts on the overview every time the dialog is reopened.
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} className="sv-wrap">
      <SettingsLayout titleId={titleId} onClose={onClose} {...content} />
    </Modal>
  );
}

type LayoutProps = Omit<ServerSettingsProps, "open"> & { titleId: string };

function SettingsLayout({
  titleId,
  onClose,
  name,
  overview,
  channels,
  roles,
  members,
  invites,
  emoji,
  soundboard,
  audit,
  bans,
  danger,
}: LayoutProps) {
  const { t } = useLanguage();
  const [active, setActive] = useState<SettingsPaneKey>("prz");
  const panesRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const current = ITEMS[active];

  useEffect(() => {
    // The panes share one scroll container; without this the second pane
    // opens as far down as the first was scrolled.
    if (panesRef.current) panesRef.current.scrollTop = 0;
    // `Modal` enters one animation frame after it mounts. Waiting one more
    // means a directly opened pane has real geometry before its tab in the
    // horizontal mobile navigation is brought into view.
    let revealFrame = 0;
    const enterFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        navRef.current
          ?.querySelector<HTMLElement>('[aria-current="page"]')
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });
    return () => {
      cancelAnimationFrame(enterFrame);
      cancelAnimationFrame(revealFrame);
    };
  }, [active]);

  /**
   * Only the visible pane is mounted, so ten live data lists do not sit behind
   * `display: none`. The section element is keyed by pane, which also replays
   * the `.sv-pane.on` entrance animation on every switch.
   */
  const pane = () => {
    switch (active) {
      case "prz":
        return <OverviewPane {...overview} />;
      case "kan":
        return <ChannelsPane {...channels} />;
      case "role":
        return <RolesPane {...roles} />;
      case "ludzie":
        return <MembersPane {...members} />;
      case "zapr":
        return <InvitesPane {...invites} />;
      case "emoji":
        return <EmojiPane {...emoji} />;
      case "board":
        return <SoundboardPane {...soundboard} />;
      case "audyt":
        return <AuditPane {...audit} />;
      case "bany":
        return <BansPane {...bans} />;
      case "danger":
        return <DangerPane {...danger} />;
    }
  };

  return (
    <div className="sv">
      {/* First in the DOM as well as on screen. On a phone the close action
          must not sit below two navigation bands, and keyboard focus should
          follow the order a reader sees. */}
      <div className="sv-bar">
        <div className="sv-bar-txt">
          <h2>{t(current.label)}</h2>
          <p>{t(current.detail)}</p>
        </div>
        <div className="sv-close">
          <button type="button" className="sv-x" aria-label={t("server.close")} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
          <span>ESC</span>
        </div>
      </div>
      <aside className="sv-nav">
        <div className="sv-brand">
          <span className="sv-brand-txt">
            <b id={titleId}>{name}</b>
            <span>{t("server.settings")}</span>
          </span>
        </div>
        <nav className="sv-nav-scroll" aria-label={t("server.sections")} ref={navRef}>
          {GROUPS.map((group) => (
            // A fragment, not a wrapper: `.sv-nav-scroll .sv-cap:first-child`
            // only means "the first caption" while the captions and the items
            // are flat siblings.
            <Fragment key={group.caption}>
              <div className="sv-cap">{t(group.caption)}</div>
              {group.panes.map((key) => {
                const item = ITEMS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className={["sv-item", key === active && "on", item.danger && "danger"]
                      .filter(Boolean)
                      .join(" ")}
                    data-pane={key}
                    aria-current={key === active ? "page" : undefined}
                    onClick={() => setActive(key)}
                  >
                    <span className="sv-ico" aria-hidden="true">
                      <Icon name={item.icon} size={18} />
                    </span>
                    {t(item.label)}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </nav>
      </aside>
      <div className="sv-main">
        <div className="sv-panes" ref={panesRef}>
          <section className="sv-pane on" data-pane={active} key={active}>
            {pane()}
          </section>
        </div>
      </div>
    </div>
  );
}
