"use client";

import { useId, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Modal } from "@/components/primitives/Modal";
import { Segmented } from "@/components/primitives/Segmented";
import { Switch } from "@/components/primitives/Switch";
import { SettingsSection } from "@/components/settings/SettingsSection";
import type { Translator } from "@/i18n";
import { toChannelSlug } from "@/lib/format";
import { useLanguage } from "@/state/hooks";

export interface ServerCreateInput {
  name: string;
  description: string;
  isPublic: boolean;
  /** The first text channel, already slugged. */
  textChannelName: string;
  /** The first voice channel, already slugged; empty creates none. */
  voiceChannelName: string;
  mentionsOnly: boolean;
  voiceJoinSound: boolean;
}

export interface ServerCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: ServerCreateInput) => Promise<void>;
}

type PaneKey = "basics" | "channels" | "visibility" | "notifications";

interface Draft {
  name: string;
  description: string;
  isPublic: boolean;
  textChannel: string;
  voiceChannel: string;
  withVoice: boolean;
  mentionsOnly: boolean;
  voiceJoinSound: boolean;
}

/** The channel names are suggestions in the reader's language, kept if left alone. */
function blankDraft(t: Translator): Draft {
  return {
    name: "",
    description: "",
    isPublic: false,
    textChannel: t("shell.starterTextChannelName"),
    voiceChannel: t("shell.starterVoiceChannelName"),
    withVoice: true,
    mentionsOnly: true,
    voiceJoinSound: true,
  };
}

interface NavItem {
  key: PaneKey;
  label: string;
  icon: IconName;
  /** The sentence under the title in the bar. */
  detail: string;
}

function navigationFor(t: Translator): readonly NavItem[] {
  return [
    {
      key: "basics",
      label: t("shell.serverBasics"),
      icon: "server",
      detail: t("shell.serverBasicsDetail"),
    },
    {
      key: "channels",
      label: t("shell.starterChannels"),
      icon: "hash",
      detail: t("shell.starterChannelsDetail"),
    },
    {
      key: "visibility",
      label: t("shell.serverVisibility"),
      icon: "eye",
      detail: t("shell.serverVisibilityDetail"),
    },
    {
      key: "notifications",
      label: t("server.notifications"),
      icon: "bell",
      detail: t("shell.serverNotificationsDetail"),
    },
  ];
}

interface FormRowProps {
  label: string;
  detail: string;
  /** The field the label belongs to; rows holding a switch or a group have none. */
  htmlFor?: string;
  /** Lays the control out as a switch, which sits at the end of the row. */
  isSwitch?: boolean;
  children: ReactNode;
}

function FormRow({ label, detail, htmlFor, isSwitch = false, children }: FormRowProps) {
  const caption = (
    <>
      {label}
      <span>{detail}</span>
    </>
  );

  return (
    <div className="frm-row">
      {htmlFor === undefined ? (
        <span className="frm-lab">{caption}</span>
      ) : (
        <label className="frm-lab" htmlFor={htmlFor}>
          {caption}
        </label>
      )}
      <div className={isSwitch ? "frm-ctl frm-switch" : "frm-ctl"}>{children}</div>
    </div>
  );
}

/**
 * Creating a server uses the server-settings shell, with the same rail, title
 * band and pane column: the form is long enough to be read in the room it
 * seeds. It is one real form, so Enter submits from any field.
 */
export function ServerCreateModal({ open, onClose, onCreate }: ServerCreateModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const textChannelId = useId();
  const voiceChannelId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(() => blankDraft(t));
  const [active, setActive] = useState<PaneKey>("basics");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset while rendering, not in an effect, so a reopened dialog is never
  // painted once with the previous draft. The draft is dropped on closing and
  // renewed on opening, which keeps the suggested names in the current language.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setActive("basics");
    setError(null);
    setDraft(blankDraft(t));
    if (!open) setSubmitting(false);
  }

  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const name = draft.name.trim();
  const textSlug = toChannelSlug(draft.textChannel);
  const voiceSlug = toChannelSlug(draft.voiceChannel);
  // The server rejects two starter channels sharing a name, so the dialog says
  // so beside the field rather than letting the submit come back with it.
  const channelsClash = draft.withVoice && textSlug.length > 0 && textSlug === voiceSlug;
  const channelsReady =
    textSlug.length > 0 && (!draft.withVoice || voiceSlug.length > 0) && !channelsClash;
  const canSubmit = name.length > 0 && channelsReady;

  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name,
        description: draft.description.trim(),
        isPublic: draft.isPublic,
        textChannelName: textSlug,
        voiceChannelName: draft.withVoice ? voiceSlug : "",
        mentionsOnly: draft.mentionsOnly,
        voiceJoinSound: draft.voiceJoinSound,
      });
      onClose();
    } catch (cause) {
      // The name is on the first pane, so a rejected name has to send the
      // reader back to the field it is about rather than report from here.
      setActive("basics");
      setError(cause instanceof Error ? cause.message : t("shell.serverCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const renderPane = () => {
    switch (active) {
      case "basics":
        return (
          <SettingsSection title={t("shell.serverBasics")} icon="server" bodyClassName="ch-settings-form">
            <div className="frm">
              <FormRow
                label={t("shell.serverName")}
                detail={t("shell.serverNameDetail")}
                htmlFor={nameId}
              >
                <input
                  id={nameId}
                  className="set-input"
                  type="text"
                  value={draft.name}
                  maxLength={80}
                  placeholder={t("shell.serverNamePlaceholder")}
                  disabled={submitting}
                  required
                  autoComplete="off"
                  aria-invalid={error !== null || undefined}
                  aria-describedby={error === null ? undefined : errorId}
                  onChange={(event) => {
                    change("name", event.target.value);
                    setError(null);
                  }}
                />
              </FormRow>
              <FormRow
                label={t("shell.serverDescription")}
                detail={t("shell.serverDescriptionDetail")}
                htmlFor={descriptionId}
              >
                <textarea
                  id={descriptionId}
                  className="set-area"
                  value={draft.description}
                  maxLength={280}
                  placeholder={t("shell.serverDescriptionPlaceholder")}
                  disabled={submitting}
                  onChange={(event) => change("description", event.target.value)}
                />
              </FormRow>
            </div>
            {error === null ? null : (
              <p id={errorId} className="set-note sound-error" role="alert">
                {error}
              </p>
            )}
          </SettingsSection>
        );
      case "channels":
        return (
          <SettingsSection title={t("shell.starterChannels")} icon="hash" bodyClassName="ch-settings-form">
            <div className="frm">
              <FormRow
                label={t("shell.starterTextChannel")}
                detail={
                  textSlug.length === 0
                    ? t("channel.lowercaseAndHyphens")
                    : t("channel.willCreate", { name: `#${textSlug}` })
                }
                htmlFor={textChannelId}
              >
                <input
                  id={textChannelId}
                  className="set-input"
                  type="text"
                  value={draft.textChannel}
                  maxLength={60}
                  placeholder={t("shell.starterTextChannelName")}
                  disabled={submitting}
                  required
                  autoComplete="off"
                  onChange={(event) => change("textChannel", event.target.value)}
                />
              </FormRow>
              <FormRow
                label={t("shell.starterVoiceChannel")}
                detail={t("shell.starterVoiceChannelDetail")}
                isSwitch
              >
                <Switch
                  checked={draft.withVoice}
                  onChange={(checked) => change("withVoice", checked)}
                  label={t("shell.withVoiceChannel")}
                  disabled={submitting}
                />
              </FormRow>
              {draft.withVoice ? (
                <FormRow
                  label={t("channel.name")}
                  detail={
                    voiceSlug.length === 0
                      ? t("channel.lowercaseAndHyphens")
                      : t("channel.willCreate", { name: voiceSlug })
                  }
                  htmlFor={voiceChannelId}
                >
                  <input
                    id={voiceChannelId}
                    className="set-input"
                    type="text"
                    value={draft.voiceChannel}
                    maxLength={60}
                    placeholder={t("shell.starterVoiceChannelName")}
                    disabled={submitting}
                    required
                    autoComplete="off"
                    aria-invalid={channelsClash || undefined}
                    onChange={(event) => change("voiceChannel", event.target.value)}
                  />
                </FormRow>
              ) : null}
            </div>
            {channelsClash ? (
              <p className="set-note sound-error" role="alert">
                {t("shell.starterChannelsClash")}
              </p>
            ) : (
              <p className="fld-note">{t("shell.starterChannelsNote")}</p>
            )}
          </SettingsSection>
        );
      case "visibility":
        return (
          <SettingsSection title={t("shell.serverVisibility")} icon="eye" bodyClassName="ch-settings-form">
            <div className="frm">
              <FormRow
                label={t("shell.serverVisibility")}
                detail={t("shell.serverVisibilityDetail")}
                isSwitch
              >
                <Switch
                  checked={draft.isPublic}
                  onChange={(checked) => change("isPublic", checked)}
                  label={t("shell.publicServer")}
                  disabled={submitting}
                />
              </FormRow>
            </div>
            <p className="fld-note">
              {draft.isPublic ? t("shell.publicServerNote") : t("shell.privateServerNote")}
            </p>
          </SettingsSection>
        );
      case "notifications":
        return (
          <SettingsSection title={t("server.notifications")} icon="bell" bodyClassName="ch-settings-form">
            <div className="frm">
              <FormRow
                label={t("shell.defaultNotifications")}
                detail={t("shell.defaultNotificationsDetail")}
              >
                <Segmented
                  label={t("shell.defaultNotifications")}
                  value={draft.mentionsOnly ? "mentions" : "all"}
                  disabled={submitting}
                  onChange={(value) => change("mentionsOnly", value === "mentions")}
                  options={[
                    {
                      value: "mentions",
                      label: t("shell.notifyMentions"),
                      detail: t("shell.notifyMentionsDetail"),
                    },
                    {
                      value: "all",
                      label: t("shell.notifyAll"),
                      detail: t("shell.notifyAllDetail"),
                    },
                  ]}
                />
              </FormRow>
              <FormRow
                label={t("shell.voiceJoinSound")}
                detail={t("shell.voiceJoinSoundDetail")}
                isSwitch
              >
                <Switch
                  checked={draft.voiceJoinSound}
                  onChange={(checked) => change("voiceJoinSound", checked)}
                  label={t("shell.voiceJoinSound")}
                  disabled={submitting}
                />
              </FormRow>
            </div>
            <p className="fld-note">{t("shell.defaultNotificationsNote")}</p>
          </SettingsSection>
        );
    }
  };

  const navigation = navigationFor(t);
  const current = navigation.find((item) => item.key === active) ?? navigation[0]!;

  return (
    <Modal open={open} onClose={close} labelledBy={titleId} className="sv-wrap">
      <form
        className="sv ch-settings"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="sv-bar">
          <div className="sv-bar-txt">
            <h2>{current.label}</h2>
            <p>{current.detail}</p>
          </div>
          <div className="sv-close">
            <button type="button" className="sv-x" aria-label={t("common.close")} onClick={close}>
              <Icon name="x" size={18} />
            </button>
            <span>ESC</span>
          </div>
        </div>

        <aside className="sv-nav">
          <div className="sv-brand ch-settings-brand">
            <span className="ch-settings-mark" aria-hidden="true">
              <Icon name="server" size={20} />
            </span>
            <span className="sv-brand-txt">
              <b id={titleId}>{name.length === 0 ? t("shell.createServer") : name}</b>
              <span>{t("shell.newServer")}</span>
            </span>
          </div>
          <nav className="sv-nav-scroll" aria-label={t("shell.createServerSections")}>
            <div className="sv-cap">{t("shell.server")}</div>
            {navigation.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === active ? "sv-item on" : "sv-item"}
                aria-current={item.key === active ? "page" : undefined}
                onClick={() => setActive(item.key)}
              >
                <span className="sv-ico" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="sv-main">
          <div className="sv-panes">
            <section className="sv-pane on" data-pane={active} key={active}>
              {renderPane()}
            </section>
          </div>
          <footer className="ch-settings-foot">
            <button type="button" className="btn-ghost" disabled={submitting} onClick={close}>
              <Icon name="x" size={15} />
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || !canSubmit}
              aria-busy={submitting || undefined}
            >
              <Icon name="tick" size={15} />
              {submitting ? t("shell.creatingServer") : t("shell.createServer")}
            </button>
          </footer>
        </div>
      </form>
    </Modal>
  );
}
