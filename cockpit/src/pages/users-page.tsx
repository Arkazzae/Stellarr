import { useCallback, useState } from "react";

import { Spinner } from "@/components/spinner";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { cockpitApi, type CockpitRole, type CockpitSession, type CockpitUsers } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { AccountsTab, type AccountFilter } from "@/pages/users/accounts-tab";
import { RoleForm } from "@/pages/users/role-form";
import { RolesTab } from "@/pages/users/roles-tab";
import { SessionsTab } from "@/pages/users/sessions-tab";
import { useAccessActions } from "@/pages/users/use-access-actions";
import { UserForm } from "@/pages/users/user-form";

interface Access extends CockpitUsers {
  sessions: CockpitSession[];
}

/** Disabling an account ends its sessions, so accounts and sessions are always read together. */
async function loadAccess(signal?: AbortSignal): Promise<Access> {
  const [directory, sessions] = await Promise.all([cockpitApi.users(signal), cockpitApi.sessions(signal)]);
  return { ...directory, sessions };
}

/** What the role sheet shows: nothing, a new role (role is null) or an existing one. */
type RoleSheet = { role: CockpitRole | null } | null;

export function UsersPage() {
  const { data: firstRead, error } = useCockpitResource(loadAccess, t("users.loadFailed"));
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
        title={t("users.title")}
        description={t("users.description")}
        actions={
          <Button onClick={() => setUserSheetOpen(true)}>
            {t("users.add")}
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("users.loadError")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant={notice.error ? "destructive" : "default"}>
          <AlertTitle>{notice.error ? t("common.error") : t("common.done")}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      {!data && !error ? (
        <div
          role="status"
          className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner className="size-4" />
          {t("users.loading")}
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
            <TabsList aria-label={t("users.areas")}>
              <TabsTrigger value="users">{t("common.users")}</TabsTrigger>
              <TabsTrigger value="sessions">
                {t("users.tab.sessions", { count: data.sessions.length })}
              </TabsTrigger>
              <TabsTrigger value="roles">{t("users.tab.roles")}</TabsTrigger>
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
