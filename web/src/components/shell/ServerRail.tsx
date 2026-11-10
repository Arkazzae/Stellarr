"use client";

import { Icon } from "@/components/icons/Icon";
import { RailLauncher, type RailLauncherItem } from "@/components/shell/RailLauncher";
import { useLanguage } from "@/state/hooks";

interface RailServer {
  id: string;
  name: string;
  mark: string;
  iconUrl?: string;
}

export interface ServerRailProps {
  open: boolean;
  onClose: () => void;
  /** The active server. */
  name: string;
  mark: string;
  iconUrl?: string;
  activeServerId?: string;
  /** Every membership. Without it the rail shows the active server alone. */
  servers?: RailServer[];
  /** True while the messages side of the app is showing. */
  dmSpace: boolean;
  onOpenMessages: () => void;
  onOpenServer: () => void;
  onSelectServer?: (serverId: string) => void;
  /** Unread private messages, summed across conversations. */
  unread: number;
  /**
   * The next two are rows of the launcher at the foot of the column. An absent
   * one renders disabled rather than hidden, so the menu says what will be there.
   */
  onCreateServer?: () => void;
  onDiscoverServers?: () => void;
  /** Opens the "which client" dialog. Left out by the desktop client, which is what it offers to install. */
  onDownloadClient?: () => void;
}

/**
 * The column of servers and direct messages.
 *
 * A grid track, not a drawer: opening it moves the whole app right, so nothing
 * sits underneath it and the channel rail beside it stays usable.
 */
export function ServerRail({
  open,
  onClose,
  name,
  mark,
  iconUrl,
  activeServerId,
  servers,
  dmSpace,
  onOpenMessages,
  onOpenServer,
  onSelectServer,
  unread,
  onCreateServer,
  onDiscoverServers,
  onDownloadClient,
}: ServerRailProps) {
  const { t } = useLanguage();

  const launcherItems: RailLauncherItem[] = [
    {
      key: "create",
      icon: "plus",
      label: t("shell.createServer"),
      hint: t(onCreateServer ? "shell.newSpace" : "shell.unavailable"),
      onSelect: onCreateServer,
    },
    {
      key: "discover",
      icon: "search",
      label: t("shell.findServers"),
      hint: t(onDiscoverServers ? "shell.browsePublic" : "shell.unavailable"),
      onSelect: onDiscoverServers,
    },
  ];
  if (onDownloadClient) {
    launcherItems.push({
      key: "client",
      icon: "download",
      label: t("shell.downloadClient"),
      hint: t("shell.downloadClientHint"),
      onSelect: onDownloadClient,
    });
  }

  const shownServers: RailServer[] = servers ?? [
    { id: activeServerId ?? "active", name, mark, iconUrl },
  ];
  const currentId = activeServerId ?? shownServers[0]?.id;

  const selectServer = (serverId: string) => {
    if (serverId !== currentId) onSelectServer?.(serverId);
    else if (dmSpace) onOpenServer();
    else onClose();
  };

  return (
    <nav
      className="srv-rail"
      aria-label={t("shell.serversAndMessages")}
      // The track is 0 wide when closed, so the contents must also leave the
      // tab order and the accessibility tree. `inert` does both; `aria-hidden`
      // could hide the button still finishing the closing click.
      inert={!open}
    >
      <div className="srv-inner">
        <button
          type="button"
          className={dmSpace ? "srv-item dm on" : "srv-item dm"}
          title={t("shell.friendsAndMessages")}
          aria-label={t("shell.friendsAndMessages")}
          aria-current={dmSpace ? "page" : undefined}
          onClick={onOpenMessages}
        >
          <Icon name="thread" size={20} />
          {unread > 0 ? (
            <span className="srv-badge">
              {unread}
              <span className="sr-only">{t("shell.unreadMessages")}</span>
            </span>
          ) : null}
        </button>

        <span className="srv-sep" aria-hidden="true" />

        <div className="srv-list">
          {shownServers.map((server) => {
            const current = !dmSpace && server.id === currentId;
            return (
              <button
                key={server.id}
                type="button"
                className={current ? "srv-item server on" : "srv-item server"}
                aria-current={current ? "page" : undefined}
                title={server.name}
                aria-label={server.name}
                onClick={() => selectServer(server.id)}
              >
                {server.iconUrl === undefined ? (
                  <span className="srv-mark">{server.mark}</span>
                ) : (
                  <img className="srv-icon" src={server.iconUrl} alt="" width={46} height={46} />
                )}
              </button>
            );
          })}
        </div>

        <RailLauncher items={launcherItems} label={t("shell.addServerMore")} />
      </div>
    </nav>
  );
}
