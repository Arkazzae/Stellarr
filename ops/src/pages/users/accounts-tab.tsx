import { Search } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import { formatShortDateTime, lowerCase } from "@/i18n/format";
import type { OpsRole, OpsUser } from "@/lib/api";
import { UserActions } from "@/pages/users/user-actions";
import type { Perform } from "@/pages/users/use-access-actions";

export interface AccountFilter {
  query: string;
  /** Empty shows every role. */
  roleId: string;
}

function PresenceBadge({ presence }: { presence: OpsUser["presence"] }) {
  if (presence === "online") return <Badge variant="success">{t("accounts.presence.online")}</Badge>;
  if (presence === "idle") return <Badge variant="warning">{t("accounts.presence.idle")}</Badge>;
  if (presence === "dnd") {
    return <Badge variant="destructive">{t("accounts.presence.dnd")}</Badge>;
  }
  return <Badge variant="outline">{t("accounts.presence.offline")}</Badge>;
}

function matchesFilter(user: OpsUser, { query, roleId }: AccountFilter): boolean {
  const needle = lowerCase(query.trim());
  const name = lowerCase(`${user.displayName} ${user.username}`);
  return name.includes(needle) && (!roleId || user.roleId === roleId);
}

interface AccountsTabProps {
  users: OpsUser[];
  roles: OpsRole[];
  filter: AccountFilter;
  onFilterChange: (filter: AccountFilter) => void;
  perform: Perform;
}

export function AccountsTab({ users, roles, filter, onFilterChange, perform }: AccountsTabProps) {
  const visible = users.filter((user) => matchesFilter(user, filter));

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{t("accounts.title")}</CardTitle>
          <CardDescription className="mt-1.5">
            {t("accounts.count", { count: users.length })}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              value={filter.query}
              onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
              className="pl-9"
              placeholder={t("accounts.search")}
              aria-label={t("accounts.search")}
            />
          </div>
          <select
            value={filter.roleId}
            onChange={(event) => onFilterChange({ ...filter, roleId: event.target.value })}
            aria-label={t("accounts.roleFilter")}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t("accounts.allRoles")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.user")}</TableHead>
              <TableHead>{t("common.role")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead>{t("common.realtime")}</TableHead>
              <TableHead>{t("accounts.col.joined")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      id={user.id}
                      displayName={user.displayName}
                      avatarUrl={user.avatarUrl}
                      className="size-8"
                    />
                    <div>
                      <p className="font-medium">{user.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        @{user.username}
                        {user.email ? ` · ${user.email}` : ""}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{user.roleName}</Badge>
                </TableCell>
                <TableCell>
                  {user.isDisabled ? (
                    <Badge variant="outline">{t("accounts.disabled")}</Badge>
                  ) : (
                    <PresenceBadge presence={user.presence} />
                  )}
                </TableCell>
                <TableCell>{user.realtimeConnections}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatShortDateTime(user.joinedAt)}
                </TableCell>
                <TableCell>
                  <UserActions user={user} roles={roles} perform={perform} />
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                  {t("accounts.empty")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
