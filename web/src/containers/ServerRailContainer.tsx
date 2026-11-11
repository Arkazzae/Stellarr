"use client";

import { ServerRail } from "@/components/shell/ServerRail";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { initials } from "@/lib/format";
import {
  useDirectory,
  useFriends,
  useSession,
  useUi,
} from "@/state/hooks";

export function ServerRailContainer() {
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
  // own grid track. On wider screens it stays open.
  const railIsDrawer = useMediaQuery("(max-width: 767px)", false);
  const open = !railIsDrawer || ui.railOpen;

  return (
    <ServerRail
      open={open}
      onClose={railIsDrawer ? () => ui.setRailOpen(false) : undefined}
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
    />
  );
}
