"use client";

import {
  useId,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import { Icon, type IconName } from "@stellarr/ui/icons";
import { AnchoredCard } from "@/components/primitives/AnchoredCard";
import { Avatar } from "@/components/primitives/Avatar";
import {
  CustomStatusText,
  ProfileBioText,
} from "@/components/profile/ProfileBio";
import type { ProfileRelation, ProfileVM } from "@/components/view-models";
import { defaultIdentityArt, hueFor } from "@/design/identity";
import type { CustomEmoji } from "@/ports";
import { useLanguage } from "@/state/hooks";

export interface MiniProfileProps {
  profile: ProfileVM;
  customEmoji?: readonly CustomEmoji[];
  /** The control the card hangs off, usually the avatar that was clicked. */
  anchor: HTMLElement;
  /**
   * False when a finger opened the card, so the message field does not raise
   * the software keyboard before the profile can be read.
   */
  autoFocus?: boolean;
  onClose: () => void;
  /** Opens the conversation, sending `text` first when there is any. */
  onMessage: (text?: string) => void;
  onAddFriend: () => void;
  onUnblock: () => void;
  /** Only on your own card: opens the settings modal on "Profil". */
  onEditProfile: () => void;
  onAcceptRequest: () => void;
  onDeclineRequest: () => void;
  onCancelRequest: () => void;
}

type RelationActions = Pick<
  MiniProfileProps,
  | "onAddFriend"
  | "onUnblock"
  | "onEditProfile"
  | "onAcceptRequest"
  | "onDeclineRequest"
  | "onCancelRequest"
>;

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

interface ToolButtonProps {
  icon: IconName;
  label: string;
  title: string;
  /** Answering a request is drawn a hair larger and tinted on hover. */
  tone?: "ok" | "no";
  onClick: () => void;
}

function ToolButton({ icon, label, title, tone, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={tone === undefined ? "mp-tool" : `mp-tool ${tone}`}
      aria-label={label}
      title={title}
      onClick={onClick}
    >
      <Icon name={icon} size={tone === undefined ? 16 : 17} />
    </button>
  );
}

/**
 * The one move the relationship is waiting on, as round icons over the banner:
 * invite, answer, withdraw, unblock. Ending a friendship or blocking someone is
 * deliberately not here; those live in the friends list's row menu.
 */
function RelationTools({
  relation,
  name,
  actions,
}: {
  relation: ProfileRelation;
  name: string;
  actions: RelationActions;
}) {
  const { t } = useLanguage();

  switch (relation) {
    case "self":
      return (
        <ToolButton
          icon="edit"
          label={t("profile.edit")}
          title={t("profile.editTitle")}
          onClick={actions.onEditProfile}
        />
      );
    case "none":
      return (
        <ToolButton
          icon="userAdd"
          label={t("profile.invite", { name })}
          title={t("profile.inviteTitle")}
          onClick={actions.onAddFriend}
        />
      );
    case "incoming":
      return (
        <>
          <ToolButton
            icon="tick"
            tone="ok"
            label={t("profile.accept", { name })}
            title={t("profile.acceptTitle")}
            onClick={actions.onAcceptRequest}
          />
          <ToolButton
            icon="x"
            tone="no"
            label={t("profile.decline", { name })}
            title={t("profile.declineTitle")}
            onClick={actions.onDeclineRequest}
          />
        </>
      );
    case "outgoing":
      return (
        <ToolButton
          icon="x"
          tone="no"
          label={t("profile.cancel", { name })}
          title={t("profile.cancelTitle")}
          onClick={actions.onCancelRequest}
        />
      );
    case "blocked":
      return (
        <ToolButton
          icon="ban"
          label={t("profile.unblock", { name })}
          title={t("profile.unblockTitle")}
          onClick={actions.onUnblock}
        />
      );
    case "friend":
      return null;
  }
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mp-fact">
      <h3 className="mp-cap">{title}</h3>
      {children}
    </section>
  );
}

/** What the server knows about them, as opposed to what they wrote. */
function Facts({ profile }: { profile: ProfileVM }) {
  const { t } = useLanguage();
  const { voiceChannelName, roles, joinedAt, friendsSince } = profile;

  return (
    <div className="mp-facts">
      {voiceChannelName === undefined ? null : (
        <Fact title={t("profile.inCall")}>
          <p className="mp-line">
            <span className="glyph" aria-hidden="true">
              <Icon name="speaker" size={14} />
            </span>
            {voiceChannelName}
          </p>
        </Fact>
      )}

      {roles.length === 0 && joinedAt === undefined ? null : (
        <div className="mp-fact-row">
          {roles.length === 0 ? null : (
            <Fact title={t("profile.roles")}>
              <ul className="mp-roles">
                {roles.map((role) => (
                  <li
                    key={role.id}
                    className="mp-role"
                    style={{ color: role.color }}
                  >
                    {role.name}
                  </li>
                ))}
              </ul>
            </Fact>
          )}
          {joinedAt === undefined ? null : (
            <Fact title={t("profile.onServerSince")}>
              <p className="mp-line">{joinedAt}</p>
            </Fact>
          )}
        </div>
      )}

      {friendsSince === undefined ? null : (
        <Fact title={t("profile.friendsSince")}>
          <p className="mp-line">{friendsSince}</p>
        </Fact>
      )}
    </div>
  );
}

/**
 * The field is controlled from the card: the form goes away while the relation
 * is blocked, and a half-written message should be waiting when it comes back.
 */
function MessageForm({
  name,
  username,
  draft,
  onDraftChange,
  onSend,
}: {
  name: string;
  username: string;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
}) {
  const { t } = useLanguage();
  const fieldId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSend();
  };

  return (
    <form className="mp-send" onSubmit={submit}>
      <label className="sr-only" htmlFor={fieldId}>
        {t("profile.writeTo", { name })}
      </label>
      <input
        id={fieldId}
        type="text"
        value={draft}
        placeholder={t("profile.writePlaceholder", { username })}
        autoComplete="off"
        onChange={(event) => onDraftChange(event.target.value)}
      />
      {/* Enter sends; the button is for whoever does not know that, and for a
          touch keyboard that has no Enter to hand. */}
      <button
        type="submit"
        className="mp-send-go"
        aria-label={t("profile.sendMessage", { name })}
        title={t("profile.sendTitle")}
        disabled={draft.trim().length === 0}
      >
        <Icon name="send" size={15} />
      </button>
    </form>
  );
}

/**
 * The mini profile: everything the app knows about a person, in a card that
 * opens beside whatever named them.
 *
 * It answers "who is this" while you keep reading, so it is not a dialog to be
 * dismissed: it has no close button, and `Escape` or a click anywhere else puts
 * it away.
 */
export function MiniProfile({
  profile,
  customEmoji = [],
  anchor,
  autoFocus = true,
  onClose,
  onMessage,
  ...actions
}: MiniProfileProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const { person, relation } = profile;
  const bannerUrl =
    profile.bannerUrl || defaultIdentityArt(person.id).bannerUrl;
  // Writing to someone you have blocked is the one thing the card will not
  // offer; to yourself there is nobody to write to.
  const canMessage = relation !== "self" && relation !== "blocked";

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    onMessage(text);
  };

  return (
    <AnchoredCard
      anchor={anchor}
      onClose={onClose}
      label={t("profile.label", { name: person.displayName })}
      className="mini-profile"
      autoFocus={autoFocus}
    >
      <div className="mp-top">
        {/* The banner shares the hue of their avatar and of their name in the
            transcript, so the card is theirs before the name is read. */}
        <div
          className="mp-banner"
          aria-hidden="true"
          style={{ "--mp-hue": hueFor(person.id) } as CSSProperties}
        >
          <img src={bannerUrl} alt="" loading="lazy" />
        </div>
        <div className="mp-tools">
          <RelationTools
            relation={relation}
            name={person.displayName}
            actions={actions}
          />
        </div>
      </div>

      {/* Half over the banner, half on the card: what makes a face read as a
          face rather than as one more row. */}
      <Avatar
        id={person.id}
        displayName={person.displayName}
        initials={person.initials}
        avatarUrl={person.avatarUrl}
        size="xl"
        presence={person.presence}
        className="mp-avatar"
      />

      <div className="mp-id">
        <h2 className="mp-name">{person.displayName}</h2>
        <p className="mp-tag">
          @{profile.username}
          {profile.pronouns === undefined ? null : (
            <span className="mp-pronouns">{profile.pronouns}</span>
          )}
        </p>
        {/* The badge on the avatar is the only visible sign of presence; the
            word is for anyone who cannot see a colour. */}
        <span className="sr-only">{t(`presence.${person.presence}`)}</span>
      </div>

      {hasText(profile.customStatus) ? (
        <p className="mp-status">
          <CustomStatusText
            text={profile.customStatus}
            customEmoji={customEmoji}
          />
        </p>
      ) : null}

      {hasText(profile.bio) ? (
        <p className="mp-bio">
          <ProfileBioText text={profile.bio} customEmoji={customEmoji} />
        </p>
      ) : null}

      <Facts profile={profile} />

      <div className="mp-acts">
        {relation === "outgoing" ? (
          <p className="mp-note">{t("profile.pendingNote")}</p>
        ) : null}
        {relation === "blocked" ? (
          <p className="mp-note">{t("profile.blockedNote")}</p>
        ) : null}
        {canMessage ? (
          <MessageForm
            name={person.displayName}
            username={profile.username}
            draft={draft}
            onDraftChange={setDraft}
            onSend={send}
          />
        ) : null}
      </div>
    </AnchoredCard>
  );
}
