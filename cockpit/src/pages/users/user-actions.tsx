import { useState } from "react";

import { Icon } from "@/components/icons/icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { cockpitApi, type CockpitRole, type CockpitUser } from "@/lib/api";
import type { Perform } from "@/pages/users/use-access-actions";

interface UserActionsProps {
  user: CockpitUser;
  roles: CockpitRole[];
  perform: Perform;
}

export function UserActions({ user, roles, perform }: UserActionsProps) {
  const [pending, setPending] = useState(false);
  // The server decides by the owner flag of the role, not by what the role is called.
  const isOwner = roles.some((role) => role.id === user.roleId && role.isOwner);
  const assignableRoles = roles.filter((role) => !role.isOwner && role.id !== user.roleId);

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    await perform(action, success, t("accountActions.failed"));
    setPending(false);
  }

  const { email } = user;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("accountActions.menu", { name: user.displayName })}
          disabled={pending}
        >
          <Icon name="dots" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user.displayName}</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!email}
          onSelect={() => {
            if (email) {
              void run(
                () => cockpitApi.requestPasswordReset(email),
                t("accountActions.resetPasswordSent", { name: user.displayName }),
              );
            }
          }}
        >
          {t("accountActions.resetPassword")}
        </DropdownMenuItem>
        {isOwner ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("accountActions.changeRole")}</DropdownMenuLabel>
            {assignableRoles.map((role) => (
              <DropdownMenuItem
                key={role.id}
                onSelect={() =>
                  void run(
                    () => cockpitApi.setUserRole(user.id, role.id),
                    t("accountActions.roleAssigned", { role: role.name }),
                  )
                }
              >
                {role.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant={user.isDisabled ? "default" : "destructive"}
          disabled={isOwner}
          onSelect={() =>
            void run(
              () => cockpitApi.setUserDisabled(user.id, !user.isDisabled),
              user.isDisabled
                ? t("accountActions.enabled", { name: user.displayName })
                : t("accountActions.disabled", { name: user.displayName }),
            )
          }
        >
          {user.isDisabled ? t("accountActions.enable") : t("accountActions.disable")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
