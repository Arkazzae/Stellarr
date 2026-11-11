"use client";

import { Icon } from "@/components/icons/Icon";
import { useLanguage } from "@/state/hooks";

export interface RailHeaderProps {
  serverName: string;
  /** Absent hides the button: who may edit is decided by the caller. */
  onEditServer?: () => void;
  onInvite?: () => void;
}

/**
 * The server's name and the two server-wide actions on the right.
 */
export function RailHeader({
  serverName,
  onEditServer,
  onInvite,
}: RailHeaderProps) {
  const { t } = useLanguage();
  return (
    <div className="rail-header">
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
