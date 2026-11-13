import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@stellarr/ui";

import { t } from "@/i18n";
import type { CockpitRole } from "@/lib/api";

interface RolesTabProps {
  roles: CockpitRole[];
  onCreate: () => void;
  onEdit: (role: CockpitRole) => void;
}

export function RolesTab({ roles, onCreate, onEdit }: RolesTabProps) {
  return (
    <Card className="min-h-0 flex-1">
      <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{t("roles.title")}</CardTitle>
          <CardDescription className="mt-1.5">{t("roles.description")}</CardDescription>
        </div>
        <Button variant="secondary" size="sm" onClick={onCreate}>
          {t("roles.add")}
        </Button>
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 overflow-auto px-4 sm:px-6">
        <Table containerClassName="overflow-visible">
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
                    <Button variant="quiet" size="sm" onClick={() => onEdit(role)}>
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
