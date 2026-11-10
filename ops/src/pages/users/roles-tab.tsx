import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OpsRole } from "@/lib/api";

interface RolesTabProps {
  roles: OpsRole[];
  onCreate: () => void;
  onEdit: (role: OpsRole) => void;
}

export function RolesTab({ roles, onCreate, onEdit }: RolesTabProps) {
  return (
    <Card className="shadow-none">
      <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Role serwera</CardTitle>
          <CardDescription className="mt-1.5">Role i efektywne uprawnienia.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus aria-hidden="true" />
          Dodaj rolę
        </Button>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rola</TableHead>
              <TableHead>Użytkownicy</TableHead>
              <TableHead>Uprawnienia</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <span
                    className="mr-2 inline-block size-2 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <span className="font-medium">{role.name}</span>
                </TableCell>
                <TableCell>{role.memberCount}</TableCell>
                <TableCell>
                  {role.permissions.length === 0 ? "Brak" : `${role.permissions.length} uprawnień`}
                </TableCell>
                <TableCell>
                  {role.isSystem ? (
                    <Badge variant="outline">Systemowa</Badge>
                  ) : (
                    <Badge variant="secondary">Własna</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {role.isOwner ? null : (
                    <Button variant="ghost" size="sm" onClick={() => onEdit(role)}>
                      Edytuj
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
