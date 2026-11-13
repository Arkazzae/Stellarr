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
import { formatShortDateTime } from "@/i18n/format";
import { cockpitApi, type CockpitSession } from "@/lib/api";
import type { Perform } from "@/pages/users/use-access-actions";

function SessionClient({ session }: { session: CockpitSession }) {
  if (!session.clientName) {
    return (
      <span className="text-sm text-muted-foreground" title={session.device}>
        {session.device}
      </span>
    );
  }
  return (
    <div title={session.device}>
      <p className="font-medium">{session.clientName}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {[session.installType, session.clientRuntime].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

interface SessionsTabProps {
  sessions: CockpitSession[];
  perform: Perform;
}

export function SessionsTab({ sessions, perform }: SessionsTabProps) {
  return (
    <Card className="min-h-0 flex-1">
      <CardHeader>
        <CardTitle>{t("sessions.title")}</CardTitle>
        <CardDescription>{t("sessions.description")}</CardDescription>
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 overflow-auto px-4 sm:px-6">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.user")}</TableHead>
              <TableHead>{t("sessions.col.client")}</TableHead>
              <TableHead>{t("sessions.col.version")}</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>{t("sessions.col.lastSeen")}</TableHead>
              <TableHead>{t("sessions.col.expires")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="font-medium">
                  {session.userDisplayName}
                  {session.current ? (
                    <Badge className="ml-2" variant="outline">
                      {t("sessions.current")}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <SessionClient session={session} />
                </TableCell>
                <TableCell>
                  {session.clientVersion ? (
                    <Badge variant="secondary">v{session.clientVersion}</Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{session.ipAddress}</TableCell>
                <TableCell>{formatShortDateTime(session.lastSeenAt)}</TableCell>
                <TableCell>{formatShortDateTime(session.expiresAt)}</TableCell>
                <TableCell>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={session.current}
                    onClick={() =>
                      void perform(
                        () => cockpitApi.revokeSession(session.id),
                        t("sessions.revoked", { name: session.userDisplayName }),
                        t("sessions.revokeFailed"),
                      )
                    }
                  >
                    {t("sessions.revoke")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  {t("sessions.empty")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
