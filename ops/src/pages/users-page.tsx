import { LoaderCircle, Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { opsApi, type OpsRole, type OpsSession, type OpsUsers } from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";
import { AccountsTab, type AccountFilter } from "@/pages/users/accounts-tab";
import { RoleForm } from "@/pages/users/role-form";
import { RolesTab } from "@/pages/users/roles-tab";
import { SessionsTab } from "@/pages/users/sessions-tab";
import { useAccessActions } from "@/pages/users/use-access-actions";
import { UserForm } from "@/pages/users/user-form";

interface Access extends OpsUsers {
  sessions: OpsSession[];
}

/** Disabling an account ends its sessions, so accounts and sessions are always read together. */
async function loadAccess(signal?: AbortSignal): Promise<Access> {
  const [directory, sessions] = await Promise.all([opsApi.users(signal), opsApi.sessions(signal)]);
  return { ...directory, sessions };
}

/** What the role sheet shows: nothing, a new role (role is null) or an existing one. */
type RoleSheet = { role: OpsRole | null } | null;

export function UsersPage() {
  const { data: firstRead, error } = useOpsResource(loadAccess, "Nie udało się pobrać danych.");
  // The reads that follow a change do not go through the resource, which would turn a failure
  // into a page error beside a success notice. Here the failure rejects and reaches the notice.
  const [newerRead, setNewerRead] = useState<Access | null>(null);
  const refresh = useCallback(async () => {
    setNewerRead(await loadAccess());
  }, []);
  const data = newerRead ?? firstRead;
  const { notice, perform } = useAccessActions(refresh);
  // The filter lives here so that it survives a visit to another tab.
  const [filter, setFilter] = useState<AccountFilter>({ query: "", roleId: "" });
  const [userSheetOpen, setUserSheetOpen] = useState(false);
  const [roleSheet, setRoleSheet] = useState<RoleSheet>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Użytkownicy i dostęp"
        description="Konta, aktywne sesje, role i uprawnienia zapisane w backendzie."
        actions={
          <Button onClick={() => setUserSheetOpen(true)}>
            <Plus aria-hidden="true" />
            Dodaj użytkownika
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Nie udało się pobrać danych</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant={notice.error ? "destructive" : "default"}>
          <AlertTitle>{notice.error ? "Błąd" : "Gotowe"}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      {!data && !error ? (
        <div
          role="status"
          className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Wczytywanie danych
        </div>
      ) : null}

      {data ? (
        <>
          <UserForm
            open={userSheetOpen}
            roles={data.roles}
            onOpenChange={setUserSheetOpen}
            perform={perform}
          />
          <RoleForm
            role={roleSheet?.role ?? null}
            open={roleSheet !== null}
            onOpenChange={(open) => {
              if (!open) setRoleSheet(null);
            }}
            perform={perform}
          />
          <Tabs defaultValue="users">
            <TabsList aria-label="Obszary dostępu">
              <TabsTrigger value="users">Użytkownicy</TabsTrigger>
              <TabsTrigger value="sessions">Sesje ({data.sessions.length})</TabsTrigger>
              <TabsTrigger value="roles">Role</TabsTrigger>
            </TabsList>
            <TabsContent value="users">
              <AccountsTab
                users={data.users}
                roles={data.roles}
                filter={filter}
                onFilterChange={setFilter}
                perform={perform}
              />
            </TabsContent>
            <TabsContent value="sessions">
              <SessionsTab sessions={data.sessions} perform={perform} />
            </TabsContent>
            <TabsContent value="roles">
              <RolesTab
                roles={data.roles}
                onCreate={() => setRoleSheet({ role: null })}
                onEdit={(role) => setRoleSheet({ role })}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
