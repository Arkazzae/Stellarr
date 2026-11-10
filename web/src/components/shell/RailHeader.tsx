"use client";

import { Icon } from "@/components/icons/Icon";
import { useLanguage } from "@/state/hooks";

export interface RailHeaderProps {
  serverName: string;
  /** Whether the servers / DM column is open; the button reports it. */
  serversOpen: boolean;
  onToggleServers: () => void;
  /** Absent hides the button: who may edit is decided by the caller. */
  onEditServer?: () => void;
  onInvite?: () => void;
}

/**
 * The server's name with the way out of it on the left, where every other app
 * puts it, and the two server-wide actions on the right.
 */
export function RailHeader({
  serverName,
  serversOpen,
  onToggleServers,
  onEditServer,
  onInvite,
}: RailHeaderProps) {
  const { t } = useLanguage();
  return (
    <div className="rail-header">
      <button
        type="button"
        className="rail-switch"
        title={t("shell.serversAndMessages")}
        aria-label={t("shell.serversAndMessages")}
        aria-expanded={serversOpen}
        onClick={onToggleServers}
      >
        <Icon name="sidebar" size={17} />
      </button>
      <h1>{serverName}</h1>
      {onEditServer === undefined ? null : (
        <button
          type="button"
          className="rail-act"
          title={t("shell.editServer")}
          aria-label={t("shell.editServer")}
          onClick={onEditServer}
        >
          <Icon name="edit" size={16} />
        </button>
      )}
      {onInvite === undefined ? null : (
        <button
          type="button"
          className="rail-act invite"
          title={t("shell.inviteToServer")}
          aria-label={t("shell.inviteToServer")}
          onClick={onInvite}
        >
          <Icon name="userAdd" size={17} />
        </button>
      )}
    </div>
  );
}
