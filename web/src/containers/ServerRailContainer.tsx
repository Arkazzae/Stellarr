"use client";

import { ServerRail } from "@/components/shell/ServerRail";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { initials } from "@/lib/format";
import {
  useDirectory,
  useFriends,
  usePorts,
  useSession,
  useUi,
} from "@/state/hooks";

export function ServerRailContainer() {
  const { desktop } = usePorts();
  const directory = useDirectory();
  const { server } = directory;
  const friends = useFriends();
  const ui = useUi();
  const session = useSession();

  const activateServer = (serverId: string) => {
    directory.selectServer(serverId);
    ui.openServer();
    session.reload();
  };

  // Below 768 the column rides inside the rail drawer instead of being its
  // own grid track, so "open" is the drawer's answer there, not the toggle's.
  const railIsDrawer = useMediaQuery("(max-width: 767px)", false);
  const open = railIsDrawer ? ui.railOpen : ui.serversOpen;

  return (
    <ServerRail
      open={open}
      onClose={() =>
        railIsDrawer ? ui.setRailOpen(false) : ui.setServersOpen(false)
      }
      name={server.name}
      mark={initials(server.name)}
      activeServerId={server.id}
      servers={directory.servers.map((item) => ({
        id: item.id,
        name: item.name,
        mark: initials(item.name),
        ...(item.iconUrl === undefined ? {} : { iconUrl: item.iconUrl }),
      }))}
      {...(server.iconUrl === undefined ? {} : { iconUrl: server.iconUrl })}
      dmSpace={ui.space === "dm"}
      onOpenMessages={ui.openFriends}
      onOpenServer={ui.openServer}
      onSelectServer={activateServer}
      unread={friends.unread}
      onCreateServer={() => ui.openModal("server-create")}
      onDiscoverServers={() => ui.openModal("server-discover")}
      // The desktop client has no download to offer itself; `ports.desktop`
      // exists only inside it.
      {...(desktop === undefined
        ? { onDownloadClient: () => ui.openModal("client") }
        : {})}
    />
  );
}
