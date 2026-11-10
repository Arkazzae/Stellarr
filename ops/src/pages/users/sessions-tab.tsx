import { KeyRound } from "lucide-react";

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
import { opsApi, type OpsSession } from "@/lib/api";
import type { Perform } from "@/pages/users/use-access-actions";

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });

function SessionClient({ session }: { session: OpsSession }) {
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
  sessions: OpsSession[];
  perform: Perform;
}

export function SessionsTab({ sessions, perform }: SessionsTabProps) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Aktywne sesje logowania</CardTitle>
        <CardDescription>
          Każda sesja odpowiada jednemu cookie logowania. Bieżącej sesji nie można odciąć z tego
          widoku.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Użytkownik</TableHead>
              <TableHead>Klient</TableHead>
              <TableHead>Wersja</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Ostatnia aktywność</TableHead>
              <TableHead>Wygasa</TableHead>
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
                      Ta sesja
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
                <TableCell>{dateFormatter.format(new Date(session.lastSeenAt))}</TableCell>
                <TableCell>{dateFormatter.format(new Date(session.expiresAt))}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={session.current}
                    onClick={() =>
                      void perform(
                        () => opsApi.revokeSession(session.id),
                        `Unieważniono sesję ${session.userDisplayName}.`,
                        "Nie udało się unieważnić sesji.",
                      )
                    }
                  >
                    <KeyRound aria-hidden="true" />
                    Unieważnij
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  Brak aktywnych sesji.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
