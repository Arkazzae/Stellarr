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
import type { OpsRole, OpsUser } from "@/lib/api";
import { UserActions } from "@/pages/users/user-actions";
import type { Perform } from "@/pages/users/use-access-actions";

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });

export interface AccountFilter {
  query: string;
  /** Empty shows every role. */
  roleId: string;
}

function PresenceBadge({ presence }: { presence: OpsUser["presence"] }) {
  if (presence === "online") return <Badge variant="success">● W sieci</Badge>;
  if (presence === "idle") return <Badge variant="warning">◐ Zaraz wracam</Badge>;
  if (presence === "dnd") return <Badge variant="destructive">■ Nie przeszkadzać</Badge>;
  return <Badge variant="outline">○ Poza siecią</Badge>;
}

function matchesFilter(user: OpsUser, { query, roleId }: AccountFilter): boolean {
  const needle = query.trim().toLocaleLowerCase("pl");
  const name = `${user.displayName} ${user.username}`.toLocaleLowerCase("pl");
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
          <CardTitle>Konta</CardTitle>
          <CardDescription className="mt-1.5">{users.length} kont w instancji.</CardDescription>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              value={filter.query}
              onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
              className="pl-9"
              placeholder="Szukaj użytkownika"
              aria-label="Szukaj użytkownika"
            />
          </div>
          <select
            value={filter.roleId}
            onChange={(event) => onFilterChange({ ...filter, roleId: event.target.value })}
            aria-label="Filtruj według roli"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Wszystkie role</option>
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
              <TableHead>Użytkownik</TableHead>
              <TableHead>Rola</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Realtime</TableHead>
              <TableHead>Dołączono</TableHead>
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
                    <Badge variant="outline">Wyłączone</Badge>
                  ) : (
                    <PresenceBadge presence={user.presence} />
                  )}
                </TableCell>
                <TableCell>{user.realtimeConnections}</TableCell>
                <TableCell className="text-muted-foreground">
                  {dateFormatter.format(new Date(user.joinedAt))}
                </TableCell>
                <TableCell>
                  <UserActions user={user} roles={roles} perform={perform} />
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                  Brak wyników.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
