import { Mail, MoreHorizontal, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { opsApi, type OpsRole, type OpsUser } from "@/lib/api";
import type { Perform } from "@/pages/users/use-access-actions";

interface UserActionsProps {
  user: OpsUser;
  roles: OpsRole[];
  perform: Perform;
}

export function UserActions({ user, roles, perform }: UserActionsProps) {
  const [pending, setPending] = useState(false);
  // The server decides by the owner flag of the role, not by what the role is called.
  const isOwner = roles.some((role) => role.id === user.roleId && role.isOwner);
  const assignableRoles = roles.filter((role) => !role.isOwner && role.id !== user.roleId);

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    await perform(action, success, "Operacja nie powiodła się.");
    setPending(false);
  }

  const { email } = user;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Akcje dla ${user.displayName}`}
          disabled={pending}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user.displayName}</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!email}
          onSelect={() => {
            if (email) {
              void run(
                () => opsApi.requestPasswordReset(email),
                `Wysłano żądanie zmiany hasła dla ${user.displayName}.`,
              );
            }
          }}
        >
          <Mail aria-hidden="true" />
          Wyślij reset hasła
        </DropdownMenuItem>
        {isOwner ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Zmień rolę</DropdownMenuLabel>
            {assignableRoles.map((role) => (
              <DropdownMenuItem
                key={role.id}
                onSelect={() =>
                  void run(
                    () => opsApi.setUserRole(user.id, role.id),
                    `Przypisano rolę ${role.name}.`,
                  )
                }
              >
                <ShieldCheck aria-hidden="true" />
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
              () => opsApi.setUserDisabled(user.id, !user.isDisabled),
              user.isDisabled
                ? `Włączono konto ${user.displayName}.`
                : `Wyłączono konto ${user.displayName} i jego sesje.`,
            )
          }
        >
          {user.isDisabled ? <UserCheck aria-hidden="true" /> : <UserX aria-hidden="true" />}
          {user.isDisabled ? "Włącz konto" : "Wyłącz konto"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
