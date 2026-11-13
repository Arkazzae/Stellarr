import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@stellarr/ui";
import { useEffect, useState, type FormEvent } from "react";

import { CardTitleRow } from "@/components/card-title-row";
import { Icon } from "@/components/icons/icon";
import { PageHeader } from "@/components/page-header";
import { t } from "@/i18n";
import { formatNumber, formatShortDateTime } from "@/i18n/format";
import { cockpitApi, type CockpitServer, type CockpitServerMember } from "@/lib/api";
import { useCockpitResource } from "@/lib/use-cockpit-resource";
import { useAccessActions, type Perform } from "@/pages/users/use-access-actions";

/** The form inside the sheet; keyed by server, so each opening starts with no members read. */
function TransferForm({ server, onDone, perform }: { server: CockpitServer; onDone: () => void; perform: Perform }) {
  const [members, setMembers] = useState<CockpitServerMember[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    cockpitApi.serverMembers(server.id, controller.signal).then(setMembers, (cause: unknown) => {
      if (controller.signal.aborted) return;
      setFailure(cause instanceof Error ? cause.message : t("servers.membersFailed"));
    });
    return () => controller.abort();
  }, [server.id]);

  const candidates = members?.filter((member) => !member.isOwner) ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = String(new FormData(event.currentTarget).get("userId"));
    const successor = candidates.find((member) => member.id === userId);
    setPending(true);
    const done = await perform(
      () => cockpitApi.transferServer(server.id, userId),
      t("servers.transferred", { server: server.name, name: successor?.displayName ?? "" }),
      t("servers.transferFailed"),
    );
    setPending(false);
    if (done) onDone();
  }

  if (failure) {
    return (
      <p role="alert" className="text-sm text-danger">
        {failure}
      </p>
    );
  }
  if (members === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        {t("servers.transfer.loading")}
      </p>
    );
  }
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("servers.transfer.none")}</p>;
  }
  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="transfer-user">{t("servers.transfer.member")}</Label>
        <select
          id="transfer-user"
          name="userId"
          required
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {candidates.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName} (@{member.username})
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : null}
        {t("servers.transfer.submit")}
      </Button>
    </form>
  );
}

function TransferSheet({
  server,
  onClose,
  perform,
}: {
  server: CockpitServer | null;
  onClose: () => void;
  perform: Perform;
}) {
  return (
    <Sheet open={server !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent closeLabel={t("common.close")} className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("servers.transfer.title", { name: server?.name ?? "" })}</SheetTitle>
          <SheetDescription>{t("servers.transfer.description")}</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          {server ? <TransferForm key={server.id} server={server} onDone={onClose} perform={perform} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DeleteDialog({
  server,
  onClose,
  perform,
}: {
  server: CockpitServer | null;
  onClose: () => void;
  perform: Perform;
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const matches = server !== null && typed.trim() === server.name;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!server || !matches) return;
    setPending(true);
    const done = await perform(
      () => cockpitApi.deleteServer(server.id),
      t("servers.deleted", { name: server.name }),
      t("servers.deleteFailed"),
    );
    setPending(false);
    if (done) onClose();
  }

  return (
    <Dialog
      open={server !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTyped("");
          onClose();
        }
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("servers.delete.title", { name: server?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("servers.delete.description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">{t("servers.delete.confirm", { name: server?.name ?? "" })}</Label>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("servers.delete.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" variant="danger-solid" disabled={!matches || pending}>
              {pending ? <Spinner /> : null}
              {t("servers.delete.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ServerActions({
  server,
  onTransfer,
  onDelete,
}: {
  server: CockpitServer;
  onTransfer: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="quiet" size="icon-sm" aria-label={t("servers.actions", { name: server.name })}>
          <Icon name="dots" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onTransfer}>{t("servers.transfer")}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          {t("servers.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ServersPage() {
  const { data, error, loading, refresh } = useCockpitResource(cockpitApi.servers, t("servers.loadFailed"));
  const { notice, perform } = useAccessActions(refresh);
  const [transferring, setTransferring] = useState<CockpitServer | null>(null);
  const [deleting, setDeleting] = useState<CockpitServer | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader title={t("servers.title")} description={t("servers.description")} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("servers.error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant={notice.error ? "destructive" : "default"}>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      {!data && loading ? (
        <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t("servers.loading")}
        </div>
      ) : null}

      {data ? (
        <Card className="min-h-0 flex-1 gap-0 py-0">
          <CardTitleRow icon="server" title={t("servers.list")}>
            <span className="text-sm text-muted-foreground">{formatNumber(data.length)}</span>
          </CardTitleRow>
          <div className="relative min-h-0 flex-1 overflow-auto px-3 pb-2 sm:px-5">
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("servers.col.server")}</TableHead>
                  <TableHead>{t("servers.col.owner")}</TableHead>
                  <TableHead className="text-right">{t("servers.col.members")}</TableHead>
                  <TableHead className="text-right">{t("servers.col.channels")}</TableHead>
                  <TableHead>{t("servers.col.visibility")}</TableHead>
                  <TableHead>{t("servers.col.created")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("servers.col.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{server.name}</span>
                        {server.isInstance ? <Badge variant="outline">{t("servers.instance")}</Badge> : null}
                      </div>
                      {server.description ? (
                        <p className="max-w-80 truncate text-xs text-muted-foreground" title={server.description}>
                          {server.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {server.owner ? (
                        <>
                          <p>{server.owner.displayName}</p>
                          <p className="text-xs text-muted-foreground">@{server.owner.username}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t("servers.noOwner")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(server.memberCount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(server.channelCount)}</TableCell>
                    <TableCell>{server.isPublic ? t("servers.public") : t("servers.private")}</TableCell>
                    <TableCell className="text-muted-foreground">{formatShortDateTime(server.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {server.isInstance ? null : (
                        <ServerActions
                          server={server}
                          onTransfer={() => setTransferring(server)}
                          onDelete={() => setDeleting(server)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}

      <TransferSheet server={transferring} onClose={() => setTransferring(null)} perform={perform} />
      <DeleteDialog server={deleting} onClose={() => setDeleting(null)} perform={perform} />
    </div>
  );
}
