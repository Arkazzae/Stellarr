"use client";

import { useMemo } from "react";

import { InviteModal, type InvitePersonVM } from "@/components/settings/InviteModal";
import { describeError } from "@/lib/api/errors";
import { initials } from "@/lib/format";
import type { MessageKey } from "@/i18n";
import {
  useDirectory,
  useFriends,
  useLanguage,
  usePorts,
  useUi,
} from "@/state/hooks";

import type { ServerAdmin } from "./useServerAdmin";

const PRESENCE_KEY: Record<InvitePersonVM["presence"], MessageKey> = {
  online: "presence.online",
  idle: "presence.idle",
  dnd: "presence.dnd",
  offline: "presence.offline",
};

/**
 * The server invite dialog: the link to copy, then the people to send it to.
 *
 * Those people are the friends. Listing the server's own members would offer
 * every row an invitation to a server it is already on; the friends who are
 * members stay on the list, marked, so their absence does not read as "you have
 * no such friend".
 */
export function InviteDialog({ open, data, reload }: ServerAdmin & { open: boolean }) {
  const { admin } = usePorts();
  const directory = useDirectory();
  const friends = useFriends();
  const ui = useUi();
  const { t } = useLanguage();

  const people = useMemo<InvitePersonVM[]>(() => {
    const members = new Set(directory.people.map((person) => person.id));
    return friends.friends
      .map(({ user }) => ({
        id: user.id,
        displayName: user.displayName,
        initials: initials(user.displayName),
        presence: user.presence,
        ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
        member: members.has(user.id),
        status: t(PRESENCE_KEY[user.presence]),
      }))
      .sort((left, right) => {
        if (left.member !== right.member) return left.member ? 1 : -1;
        return left.displayName.localeCompare(right.displayName, "pl-PL");
      });
  }, [directory.people, friends.friends, t]);

  const invite = data.invites[0];

  return (
    <InviteModal
      open={open}
      onClose={ui.closeModal}
      serverName={directory.server.name}
      people={people}
      inviteUrl={invite?.url ?? ""}
      {...(admin.supported.invites
        ? {
            onCreateInvite: async () => {
              try {
                await admin.createInvite();
                reload();
              } catch (cause) {
                throw new Error(describeError(cause, t("invite.createFailed"), t));
              }
            },
          }
        : {})}
      onInvite={async (userId) => {
        if (invite === undefined) throw new Error(t("invite.createFailed"));
        try {
          await admin.sendInvite(invite.id, userId);
        } catch (cause) {
          throw new Error(describeError(cause, t("invite.sendFailed"), t));
        }
      }}
      onCopy={(url) => {
        void navigator.clipboard?.writeText(url).catch(() => {
          // A denied clipboard leaves the link on screen to copy by hand.
        });
      }}
    />
  );
}
