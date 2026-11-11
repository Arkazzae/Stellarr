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
import { t } from "@/i18n";
import type { OpsRole } from "@/lib/api";

interface RolesTabProps {
  roles: OpsRole[];
  onCreate: () => void;
  onEdit: (role: OpsRole) => void;
}

export function RolesTab({ roles, onCreate, onEdit }: RolesTabProps) {
  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{t("roles.title")}</CardTitle>
          <CardDescription className="mt-1.5">{t("roles.description")}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onCreate}>
          {t("roles.add")}
        </Button>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.role")}</TableHead>
              <TableHead>{t("common.users")}</TableHead>
              <TableHead>{t("roles.col.permissions")}</TableHead>
              <TableHead>{t("roles.col.type")}</TableHead>
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
                  {role.permissions.length === 0
                    ? t("common.none")
                    : t("roles.permissionCount", { count: role.permissions.length })}
                </TableCell>
                <TableCell>
                  {role.isSystem ? (
                    <Badge variant="outline">{t("roles.typeSystem")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("roles.typeCustom")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {role.isOwner ? null : (
                    <Button variant="ghost" size="sm" onClick={() => onEdit(role)}>
                      {t("roles.edit")}
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
