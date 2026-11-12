"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { Modal } from "@/components/primitives/Modal";
import { DialogHeader } from "@/components/settings/DialogHeader";
import type { PersonVM } from "@/components/view-models";
import { useLanguage } from "@/state/hooks";

export interface InvitePersonVM extends PersonVM {
  /** Presence as words ("Online", "Do not disturb"), resolved by the container. */
  status: string;
  /** Already a member: the row states that instead of offering an invite. */
  member?: boolean;
}

export interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  /** Whose invite this is. Invites are server-scoped, never channel-scoped. */
  serverName: string;
  people: readonly InvitePersonVM[];
  /** The server's invite link, or "" while it has none. */
  inviteUrl: string;
  /** People the container already knows were invited. */
  invitedIds?: readonly string[];
  /** Undefined hides the action — the port cannot mint invites. */
  onCreateInvite?: () => Promise<void>;
  onInvite: (personId: string) => Promise<void>;
  /** The container owns the clipboard write; this only flashes "Skopiowano". */
  onCopy: (url: string) => void;
}

type Progress = Readonly<Record<string, "sending" | "sent" | undefined>>;

const COPIED_FLASH_MS = 1400;

/**
 * The server invite dialog: the link to copy, then the friends to push it to.
 * There is no channel-scoped invite anywhere in the stack, so nothing here
 * names a channel.
 */
export function InviteModal({
  open,
  onClose,
  serverName,
  people,
  inviteUrl,
  invitedIds,
  onCreateInvite,
  onInvite,
  onCopy,
}: InviteModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<Progress>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // A closed dialog forgets what was typed and who was just invited. It
  // happens while rendering so the cleared dialog is part of the same commit
  // as the prop change.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setProgress({});
      setActionError(null);
      setCopied(false);
    }
  }

  const hasLink = inviteUrl !== "";
  const needle = query.trim().toLocaleLowerCase("pl-PL");
  const shown =
    needle === ""
      ? people
      : people.filter((person) => person.displayName.toLocaleLowerCase("pl-PL").includes(needle));

  const copy = () => {
    onCopy(inviteUrl);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
  };

  const createInvite = async () => {
    if (onCreateInvite === undefined) return;
    setActionError(null);
    try {
      await onCreateInvite();
    } catch {
      setActionError(t("invite.createFailed"));
    }
  };

  const mark = (personId: string, status: "sending" | "sent" | undefined) =>
    setProgress((current) => ({ ...current, [personId]: status }));

  const send = async (personId: string) => {
    if (progress[personId] !== undefined) return;
    setActionError(null);
    mark(personId, "sending");
    try {
      await onInvite(personId);
      mark(personId, "sent");
    } catch {
      setActionError(t("invite.sendFailed"));
      mark(personId, undefined);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className="act-modal inv-modal"
      exitMs={200}
    >
      <div className="am-card">
        <DialogHeader
          titleId={titleId}
          title={t("invite.title")}
          detail={t("invite.subtitle", { server: serverName })}
          onClose={onClose}
        />

        <div className="dlg-body">
          <section className="dlg-block">
            <span className="fld-lab">{t("invite.linkLabel")}</span>
            {hasLink ? (
              <>
                <div className="dlg-field">
                  <span className="dlg-mono">{inviteUrl}</span>
                  <button
                    type="button"
                    className={copied ? "btn-primary sm inv-copy done" : "btn-primary sm inv-copy"}
                    onClick={copy}
                  >
                    <Icon name={copied ? "tick" : "copy"} size={14} />
                    {copied ? t("invite.copied") : t("invite.copy")}
                  </button>
                </div>
                <p className="fld-note">{t("invite.linkNote")}</p>
              </>
            ) : (
              <div className="dlg-retry">
                <p>{t("invite.noLink")}</p>
                {onCreateInvite === undefined ? null : (
                  <button type="button" className="btn-ghost sm" onClick={() => void createInvite()}>
                    <Icon name="plus" size={14} />
                    {t("settings.newInvite")}
                  </button>
                )}
              </div>
            )}
          </section>

          {actionError === null ? null : (
            <p className="fld-note bad" role="alert">
              {actionError}
            </p>
          )}

          <section className="dlg-block grow">
            <span className="fld-lab">{t("invite.peopleLabel")}</span>
            <div className="dlg-search">
              <span className="dlg-si" aria-hidden="true">
                <Icon name="search" size={14} />
              </span>
              <input
                className="dlg-input"
                type="search"
                aria-label={t("invite.search")}
                placeholder={t("invite.searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="dlg-list">
              {shown.length === 0 ? (
                <div className="asset-empty">
                  <Icon name="userAdd" size={24} />
                  <b>{needle === "" ? t("invite.noFriends") : t("invite.noMatches")}</b>
                  <span>
                    {needle === "" ? t("invite.noFriendsDetail") : t("invite.noMatchesDetail")}
                  </span>
                </div>
              ) : (
                shown.map((person) => {
                  const sent = progress[person.id] === "sent" || invitedIds?.includes(person.id);
                  const sending = progress[person.id] === "sending";
                  return (
                    <div className="dlg-row" key={person.id}>
                      <Avatar
                        id={person.id}
                        displayName={person.displayName}
                        initials={person.initials}
                        avatarUrl={person.avatarUrl}
                      />
                      <span className="dlg-who">
                        <b>{person.displayName}</b>
                        <span>{person.status}</span>
                      </span>
                      {person.member === true ? (
                        <span className="dlg-state">{t("invite.alreadyMember")}</span>
                      ) : (
                        <button
                          type="button"
                          className={sent ? "btn-ghost sm inv-btn sent" : "btn-ghost sm inv-btn"}
                          aria-label={`${t("invite.button")} ${person.displayName}`}
                          disabled={!hasLink || sent || sending}
                          onClick={() => void send(person.id)}
                        >
                          {sent ? <Icon name="tick" size={13} /> : null}
                          {sent ? t("invite.sent") : sending ? t("invite.sending") : t("invite.button")}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <footer className="dlg-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t("common.done")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
