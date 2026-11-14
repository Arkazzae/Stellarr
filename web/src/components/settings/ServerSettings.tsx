"use client";

import { useId, useState } from "react";

import type { IconName } from "@stellarr/ui/icons";
import { Modal } from "@/components/primitives/Modal";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SettingsGuardProvider, useSettingsGuardHost } from "@/components/settings/settingsGuard";
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
  // Escape and a press outside close through the same guard as the cross, so
  // an unsaved overview is never thrown away by any of them.
  const guard = useSettingsGuardHost();

  // The modal mounts its children only while it is open, so the layout below
  // starts on the overview every time the dialog is reopened.
  return (
    <Modal
      open={open}
      onClose={() => guard.attempt(onClose)}
      labelledBy={titleId}
      className="sv-wrap"
    >
      <SettingsGuardProvider guard={guard}>
        <SettingsLayout titleId={titleId} onClose={onClose} {...content} />
      </SettingsGuardProvider>
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
  const current = ITEMS[active];

  /**
   * Only the visible pane is mounted, so ten live data lists do not sit behind
   * `display: none`.
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

  const groups = GROUPS.map((group) => ({
    caption: t(group.caption),
    items: group.panes.map((key) => ({
      key,
      label: t(ITEMS[key].label),
      icon: ITEMS[key].icon,
      danger: ITEMS[key].danger,
    })),
  }));

  return (
    <SettingsShell
      titleId={titleId}
      brand={{ name, detail: t("server.settings") }}
      title={t(current.label)}
      detail={t(current.detail)}
      closeLabel={t("server.close")}
      onClose={onClose}
      navLabel={t("server.sections")}
      groups={groups}
      active={active}
      onSelect={setActive}
    >
      {pane()}
    </SettingsShell>
  );
}
