"use client";

import { useState } from "react";

import {
  AccountPanel,
  type AccountPanelProps,
} from "@/components/account/AccountPanel";
import { Avatar } from "@/components/primitives/Avatar";
import { IconButton } from "@/components/primitives/IconButton";
import { Popover } from "@/components/primitives/Popover";
import { CustomStatusText } from "@/components/profile/ProfileBio";
import type { PersonVM } from "@/components/view-models";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/hooks";

const PRESENCE_LABEL: Record<PersonVM["presence"], MessageKey> = {
  online: "account.presence.onlineLabel",
  idle: "account.presence.idleLabel",
  dnd: "account.presence.dndLabel",
  offline: "account.presence.offlineLabel",
};

export interface AccountRowProps {
  user: PersonVM;
  onOpenSettings: () => void;
  /**
   * Opens direct messages. Omitted while nothing is behind it: the control
   * still renders, disabled and labelled, so that it does not appear later and
   * move the settings button out from under the reader's cursor.
   */
  onOpenMessages?: () => void;
  /** Everything the panel above the row needs; the row only opens it. */
  panel: AccountPanelProps;
}

/** The signed-in user at the foot of the rail, and the handle of the account panel. */
export function AccountRow({
  user,
  onOpenSettings,
  onOpenMessages,
  panel,
}: AccountRowProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  /** Every action on the panel except picking a status ends the visit. */
  const closing = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  const presenceLabel = t(PRESENCE_LABEL[user.presence]);
  const hasCustomStatus = panel.customStatus.trim().length > 0;
  const messagesLabel =
    onOpenMessages === undefined ? t("shell.dmUnavailable") : t("shell.dm");

  return (
    <div className="account">
      {/* The panel slides out of the row, anchored inside the rail rather than
          floating beside it. */}
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="acc-pop"
        renderTrigger={(trigger) => (
          <button {...trigger} type="button" className="acc-open">
            {/* Call state is not repeated here: the voice dock directly above
                already shows it. */}
            <Avatar
              id={user.id}
              displayName={user.displayName}
              initials={user.initials}
              avatarUrl={user.avatarUrl}
              presence={user.presence}
            />
            <span className="who">
              <b>{user.displayName}</b>
              <span className="astate" title={panel.customStatus || presenceLabel}>
                {hasCustomStatus ? (
                  <CustomStatusText
                    text={panel.customStatus}
                    customEmoji={panel.customEmoji}
                  />
                ) : (
                  presenceLabel
                )}
              </span>
            </span>
          </button>
        )}
      >
        <AccountPanel
          {...panel}
          // Picking a status leaves the panel open: the dot beside the name
          // confirms it, and the next thing may be a line of status text.
          onOpenSettings={closing(panel.onOpenSettings)}
          onLogout={closing(panel.onLogout)}
        />
      </Popover>
      <IconButton
        icon="thread"
        size={16}
        label={messagesLabel}
        title={messagesLabel}
        disabled={onOpenMessages === undefined}
        onClick={onOpenMessages}
      />
      <IconButton
        icon="gear"
        size={16}
        label={t("common.openSettings")}
        title={t("common.openSettings")}
        onClick={onOpenSettings}
      />
    </div>
  );
}
