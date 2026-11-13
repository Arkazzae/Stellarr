"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { Modal } from "@/components/primitives/Modal";
import { DialogHeader } from "@/components/settings/DialogHeader";
import type { PersonVM } from "@/components/view-models";
import { inviteExpiry } from "@/lib/invites";
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
  /**
   * When the link stops working: an ISO date, or null when it never does.
   * Left out, the dialog says nothing about it.
   */
  inviteExpiresAt?: string | null;
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
 * The server invite dialog: the friends to send an invitation to, and under
 * them, pinned, the link for everyone else.
 *
 * The friends come first because inviting one is the dialog's one-tap action;
 * the link stays in view below however long the list grows. Without friends
 * there is nothing to search, so the dialog shrinks to its title, a sentence
 * saying so, and the link. There is no channel-scoped invite anywhere in the stack, so nothing
 * here names a channel.
 */
export function InviteModal({
  open,
  onClose,
  serverName,
  people,
  inviteUrl,
  inviteExpiresAt,
  invitedIds,
  onCreateInvite,
  onInvite,
  onCopy,
}: InviteModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<Progress>({});
  const [sendError, setSendError] = useState<string | null>(null);

  // A closed dialog forgets what was typed and who was just invited. It
  // happens while rendering so the cleared dialog is part of the same commit
  // as the prop change.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setProgress({});
      setSendError(null);
    }
  }

  const hasLink = inviteUrl !== "";
  const hasFriends = people.length > 0;
  const needle = query.trim().toLocaleLowerCase("pl-PL");
  const shown =
    needle === ""
      ? people
      : people.filter((person) => person.displayName.toLocaleLowerCase("pl-PL").includes(needle));

  const mark = (personId: string, status: "sending" | "sent" | undefined) =>
    setProgress((current) => ({ ...current, [personId]: status }));

  const send = async (personId: string) => {
    if (progress[personId] !== undefined) return;
    setSendError(null);
    mark(personId, "sending");
    try {
      await onInvite(personId);
      mark(personId, "sent");
    } catch {
      setSendError(t("invite.sendFailed"));
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
      <div className={hasFriends ? "am-card" : "am-card inv-alone"}>
        <DialogHeader
          titleId={titleId}
          title={t("invite.title", { server: serverName })}
          detail={hasFriends ? t("invite.subtitle") : t("invite.subtitleAlone")}
          onClose={onClose}
        />

        {hasFriends ? (
          <div className="inv-people">
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

            {sendError === null ? null : (
              <p className="inv-error" role="alert">
                {sendError}
              </p>
            )}

            <div className="inv-list">
              {shown.length === 0 ? (
                <div className="inv-empty">
                  <b>{t("invite.noMatches")}</b>
                  <span>{t("invite.noMatchesDetail")}</span>
                </div>
              ) : (
                shown.map((person) => {
                  const sent = progress[person.id] === "sent" || invitedIds?.includes(person.id);
                  const sending = progress[person.id] === "sending";
                  return (
                    <div className="dlg-row inv-row" key={person.id}>
                      <Avatar
                        id={person.id}
                        displayName={person.displayName}
                        initials={person.initials}
                        avatarUrl={person.avatarUrl}
                        presence={person.presence}
                      />
                      <span className="dlg-who">
                        <b>{person.displayName}</b>
                        <span>{person.status}</span>
                      </span>
                      {person.member === true ? (
                        <span className="inv-member">{t("invite.alreadyMember")}</span>
                      ) : (
                        <button
                          type="button"
                          className={sent ? "inv-send sent" : "inv-send"}
                          aria-label={`${t("invite.button")} ${person.displayName}`}
                          disabled={!hasLink || sent || sending}
                          onClick={() => void send(person.id)}
                        >
                          {sent ? <Icon name="tick" size={14} /> : null}
                          {sent ? t("invite.sent") : sending ? t("invite.sending") : t("invite.button")}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        <InviteLink
          url={inviteUrl}
          expiresAt={inviteExpiresAt}
          alone={!hasFriends}
          onCreate={onCreateInvite}
          onCopy={onCopy}
        />
      </div>
    </Modal>
  );
}

interface InviteLinkProps {
  url: string;
  expiresAt: string | null | undefined;
  /** No friends above it, so it is the only way in rather than the other one. */
  alone: boolean;
  onCreate: (() => Promise<void>) | undefined;
  onCopy: (url: string) => void;
}

/**
 * The link, pinned under the friends: a field to select it from, the copy
 * button inside it, and how long it keeps working.
 *
 * Its own component because it mounts with the open dialog, so the moment
 * the expiry is counted from and the "copied" flash both start fresh with
 * every opening.
 */
function InviteLink({ url, expiresAt, alone, onCreate, onCopy }: InviteLinkProps) {
  const { t, locale } = useLanguage();
  const [now] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copy = () => {
    onCopy(url);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
  };

  const create = async () => {
    if (onCreate === undefined) return;
    setError(null);
    try {
      await onCreate();
    } catch {
      setError(t("invite.createFailed"));
    }
  };

  const left = expiresAt === undefined ? null : inviteExpiry(expiresAt, now);
  const lifetime =
    left === null
      ? null
      : left.state === "never"
        ? t("invite.expiresNever")
        : left.state === "expired"
          ? t("invite.expired")
          : t("invite.expiresIn", {
              time: new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(
                left.value,
                left.unit,
              ),
            });

  return (
    <section className="inv-link">
      <h3 className="inv-link-lab">{alone ? t("invite.linkField") : t("invite.linkLabel")}</h3>
      {url === "" ? (
        <div className="inv-nolink">
          <p>{t("invite.noLink")}</p>
          {onCreate === undefined ? null : (
            <Button type="button" variant="primary" size="sm" onClick={() => void create()}>
              <Icon name="plus" size={14} />
              {t("settings.newInvite")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="inv-field">
            <input
              className="inv-url"
              type="text"
              readOnly
              value={url}
              aria-label={t("invite.linkField")}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              className={copied ? "inv-copy done" : "inv-copy"}
              onClick={copy}
            >
              <Icon name={copied ? "tick" : "copy"} size={14} />
              {copied ? t("invite.copied") : t("invite.copy")}
            </Button>
          </div>
          <p className="inv-note">
            {lifetime === null ? null : `${lifetime} `}
            {t("invite.linkNote")}
          </p>
        </>
      )}
      {error === null ? null : (
        <p className="inv-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
