"use client";

import { useEffect, useId, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { Modal } from "@/components/primitives/Modal";
import { DialogHeader } from "@/components/settings/DialogHeader";
import { initials } from "@/lib/format";
import type { Server } from "@/ports";
import { useLanguage } from "@/state/hooks";

export interface ServerDiscoverModalProps {
  open: boolean;
  onClose: () => void;
  loadServers: () => Promise<readonly Server[]>;
  onJoinServer: (serverId: string) => Promise<void>;
  onJoinInvite: (invite: string) => Promise<void>;
}

type Directory =
  | { status: "loading" }
  /** Without a message the failure was not an Error and the dialog words it. */
  | { status: "failed"; message?: string }
  | { status: "ready"; servers: readonly Server[] };

type Joining = { kind: "server"; serverId: string } | { kind: "invite" };

/**
 * Finding a server asks for a code and offers a list: the same shape as the
 * invite dialog, so it wears that dialog's short card.
 */
export function ServerDiscoverModal({
  open,
  onClose,
  loadServers,
  onJoinServer,
  onJoinInvite,
}: ServerDiscoverModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const inviteId = useId();
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState("");
  const [directory, setDirectory] = useState<Directory>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState<Joining | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset while rendering, not in an effect, so a reopened dialog starts from
  // the loading list rather than flashing the previous answer.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setActionError(null);
    if (!open) {
      setQuery("");
      setInvite("");
      setDirectory({ status: "loading" });
      setJoining(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let current = true;
    void loadServers().then(
      (servers) => {
        if (current) setDirectory({ status: "ready", servers });
      },
      (cause: unknown) => {
        if (current) {
          setDirectory({
            status: "failed",
            ...(cause instanceof Error ? { message: cause.message } : {}),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [open, loadServers, attempt]);

  const servers = directory.status === "ready" ? directory.servers : [];
  const needle = query.trim().toLocaleLowerCase();
  const shown =
    needle.length === 0
      ? servers
      : servers.filter((server) =>
          `${server.name} ${server.description ?? ""}`.toLocaleLowerCase().includes(needle),
        );

  const busy = joining !== null;
  const close = () => {
    if (!busy) onClose();
  };

  const join = async (target: Joining, action: () => Promise<void>) => {
    if (busy) return;
    setJoining(target);
    setActionError(null);
    try {
      await action();
      onClose();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("shell.serverJoinFailed"));
    } finally {
      setJoining(null);
    }
  };

  const inviteCode = invite.trim();
  const joiningInvite = joining?.kind === "invite";

  return (
    <Modal
      open={open}
      onClose={close}
      labelledBy={titleId}
      className="act-modal find-modal"
      exitMs={200}
    >
      <div className="am-card">
        <DialogHeader
          titleId={titleId}
          title={t("shell.findServers")}
          detail={t("shell.findServersDetail")}
          onClose={close}
          closeDisabled={busy}
          centered
        />

        <div className="dlg-body">
          <section className="dlg-block">
            <label className="fld-lab" htmlFor={inviteId}>
              {t("shell.inviteCode")}
            </label>
            {/* Its own form, so Enter in the field joins rather than doing
                nothing next to a list that has no submit of its own. */}
            <form
              className="dlg-field"
              onSubmit={(event) => {
                event.preventDefault();
                if (inviteCode.length > 0) {
                  void join({ kind: "invite" }, () => onJoinInvite(inviteCode));
                }
              }}
            >
              <input
                id={inviteId}
                className="dlg-input"
                type="text"
                value={invite}
                placeholder={t("shell.inviteCodePlaceholder")}
                disabled={busy}
                required
                autoComplete="off"
                onChange={(event) => {
                  setInvite(event.target.value);
                  setActionError(null);
                }}
              />
              <button
                type="submit"
                className="btn-primary sm find-join"
                disabled={busy || inviteCode.length === 0}
                aria-busy={joiningInvite || undefined}
              >
                {joiningInvite ? t("shell.joiningServer") : t("shell.joinInvite")}
              </button>
            </form>
            <p className="fld-note">{t("shell.inviteCodeDetail")}</p>
          </section>

          <section className="dlg-block grow">
            <span className="fld-lab">{t("shell.publicServers")}</span>
            <div className="dlg-search">
              <span className="dlg-si" aria-hidden="true">
                <Icon name="search" size={14} />
              </span>
              <input
                className="dlg-input"
                type="search"
                aria-label={t("shell.searchServers")}
                value={query}
                placeholder={t("shell.searchServersPlaceholder")}
                disabled={directory.status === "loading"}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="dlg-list">
              {directory.status === "loading" ? (
                <div className="dlg-skeleton" role="status" aria-live="polite">
                  <span className="sr-only">{t("shell.loadingServers")}</span>
                  {[0, 1, 2].map((row) => (
                    <div className="dlg-skeleton-row" key={row} aria-hidden="true">
                      <i />
                      <span>
                        <b />
                        <em />
                      </span>
                    </div>
                  ))}
                </div>
              ) : directory.status === "failed" ? (
                <div className="dlg-retry" role="alert">
                  <p>{directory.message ?? t("shell.serverDiscoveryFailed")}</p>
                  <button
                    type="button"
                    className="btn-ghost sm"
                    onClick={() => {
                      setDirectory({ status: "loading" });
                      setAttempt((count) => count + 1);
                    }}
                  >
                    {t("common.retry")}
                  </button>
                </div>
              ) : shown.length === 0 ? (
                <div className="asset-empty">
                  <Icon name="server" size={24} />
                  <b>{servers.length === 0 ? t("shell.noPublicServers") : t("shell.noServerMatch")}</b>
                  <span>
                    {servers.length === 0
                      ? t("shell.noPublicServersDetail")
                      : t("shell.noServerMatchDetail")}
                  </span>
                </div>
              ) : (
                shown.map((server) => {
                  const joiningThis =
                    joining?.kind === "server" && joining.serverId === server.id;
                  return (
                    <div className="dlg-row" key={server.id}>
                      <span className="dlg-mark" aria-hidden="true">
                        {server.iconUrl === undefined ? (
                          initials(server.name)
                        ) : (
                          <img src={server.iconUrl} alt="" />
                        )}
                      </span>
                      <span className="dlg-who">
                        <b>{server.name}</b>
                        <span>{server.description || t("shell.publicServerNoDescription")}</span>
                      </span>
                      <button
                        type="button"
                        className="btn-ghost sm find-join"
                        disabled={busy}
                        aria-busy={joiningThis || undefined}
                        onClick={() =>
                          void join({ kind: "server", serverId: server.id }, () =>
                            onJoinServer(server.id),
                          )
                        }
                      >
                        {joiningThis ? t("shell.joiningServer") : t("shell.joinServer")}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {actionError === null ? null : (
            <p className="set-note sound-error dlg-note" role="alert">
              {actionError}
            </p>
          )}
        </div>

        <footer className="dlg-foot">
          <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
            <Icon name="x" size={15} />
            {t("common.close")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
