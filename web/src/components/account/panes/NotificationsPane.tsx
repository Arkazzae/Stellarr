"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { Segmented } from "@/components/primitives/Segmented";
import { Switch } from "@/components/primitives/Switch";
import type { MessageKey } from "@/i18n";
import type { UserPreferences } from "@/ports";
import { useLanguage } from "@/state/hooks";

import type { PreferencePaneProps } from "./PreferencePanes";

/** System notifications are a device permission as well as a stored preference. */
export interface SystemNotificationPreferenceProps {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  pending: boolean;
  error: boolean;
  /**
   * Whether a mention pops up here as well as a call. The Android app's bridge
   * rings calls only, so there a mention stays in the app.
   */
  mentions: boolean;
  onChange(enabled: boolean): void;
  /** Shows one now. Absent where the device cannot show one on request. */
  onTest?: () => void;
}

/** A muted channel of the server in view, as the pane lists it. */
export interface MutedChannel {
  id: string;
  name: string;
  /** The rail section it sits in, when it sits in one. */
  section?: string;
}

/**
 * The account's muted channels. The client knows the channels of the server in
 * view only, so the others are a count: on another server, or since deleted.
 */
export interface MutedChannelsProps {
  serverName: string;
  channels: readonly MutedChannel[];
  elsewhere: number;
  onUnmute: (channelId: string) => void;
}

export interface UserNotificationsPaneProps extends PreferencePaneProps {
  systemNotifications?: SystemNotificationPreferenceProps;
  muted?: MutedChannelsProps;
  /** Plays the message sound once, so the choice is made by ear. */
  onPlaySound?: () => void;
}

type SoundChoice = "mentions" | "all" | "off";
type Outcome = "sound" | "popup" | "inbox";
type Example = "call" | "mention" | "message" | "muted";
type Outcomes = Record<Example, Record<Outcome, boolean>>;

const OUTCOMES: readonly { key: Outcome; icon: IconName; label: MessageKey }[] = [
  { key: "sound", icon: "sound", label: "notifications.stage.sound" },
  { key: "popup", icon: "monitor", label: "notifications.stage.popup" },
  // The bell, because that is the button the inbox opens from.
  { key: "inbox", icon: "bell", label: "notifications.stage.inbox" },
];

function soundChoice({ messageSound, mentionsOnly }: UserPreferences): SoundChoice {
  if (!messageSound) return "off";
  return mentionsOnly ? "mentions" : "all";
}

/**
 * What each example would do with the settings as they stand. It restates the
 * rules the app follows (`shouldPlayMessageNotificationSound`, the call
 * banner, `shouldShowMentionNotification`, the server's mention inbox), so a
 * change to one of them belongs here too.
 */
function outcomesOf(
  preferences: UserPreferences,
  system: SystemNotificationPreferenceProps | undefined,
): Outcomes {
  const popups = system?.permission === "granted" && preferences.desktopNotifications;
  return {
    // The ringtone plays whenever the app is open; it is not a setting.
    call: { sound: true, popup: popups, inbox: false },
    mention: {
      sound: preferences.messageSound,
      popup: popups && system?.mentions === true,
      inbox: true,
    },
    message: {
      sound: preferences.messageSound && !preferences.mentionsOnly,
      popup: false,
      inbox: false,
    },
    // Muting silences a channel in this app; the server still files the mention.
    muted: { sound: false, popup: false, inbox: true },
  };
}

function signature(outcomes: Outcomes): string {
  return Object.values(outcomes)
    .map((row) => OUTCOMES.map(({ key }) => (row[key] ? "1" : "0")).join(""))
    .join(" ");
}

/**
 * What reaches you: four everyday events and, for each, whether it makes a
 * sound, pops up over other apps and lands in the inbox. It opens the pane
 * the way the app in miniature opens the appearance pane: the choices below
 * are read as their consequences before they are read as switches. A cell a
 * change has just turned over answers once.
 */
function Stage({ outcomes }: { outcomes: Outcomes }) {
  const { t } = useLanguage();
  const current = signature(outcomes);
  const [seen, setSeen] = useState({ signature: current, changed: "", turn: 0 });
  if (seen.signature !== current) {
    const before = seen.signature.split("");
    const changed = current
      .split("")
      .map((bit, index) => (bit !== before[index] ? String(index) : null))
      .filter((index) => index !== null)
      .join(",");
    setSeen({ signature: current, changed, turn: seen.turn + 1 });
  }
  const turned = new Set(seen.changed.split(","));

  const examples: { key: Example; face: ReactNode; title: string; where: string }[] = [
    {
      key: "call",
      face: <span className="nt-glyph"><Icon name="phone" size={16} /></span>,
      title: t("notifications.stage.call", { name: "Ada" }),
      where: t("notifications.stage.callWhere"),
    },
    {
      key: "mention",
      face: <Avatar id="podglad-nils" displayName="Nils" size="sm" />,
      title: t("notifications.stage.mention", { name: "Nils" }),
      where: t("notifications.stage.in", { channel: t("theme.stage.design") }),
    },
    {
      key: "message",
      face: <Avatar id="podglad-ada" displayName="Ada" size="sm" />,
      title: t("notifications.stage.message"),
      where: t("notifications.stage.notOpen", { channel: t("theme.stage.random") }),
    },
    {
      key: "muted",
      face: <span className="nt-glyph"><Icon name="bellSlash" size={16} /></span>,
      title: t("notifications.stage.muted"),
      where: t("notifications.stage.in", { channel: t("notifications.stage.mutedChannel") }),
    },
  ];

  return (
    <div className="nt-stage">
      <table className="nt-table">
        <colgroup>
          <col />
          <col className="nt-col" />
          <col className="nt-col" />
          <col className="nt-col" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{t("notifications.stage.title")}</th>
            {OUTCOMES.map(({ key, icon, label }) => (
              <th scope="col" key={key}>
                <span className="nt-head">
                  <Icon name={icon} size={15} />
                  {t(label)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {examples.map(({ key, face, title, where }, row) => (
            <tr key={key} data-example={key}>
              <th scope="row">
                <span className="nt-who">
                  {face}
                  <span>
                    <b>{title}</b>
                    <small>{where}</small>
                  </span>
                </span>
              </th>
              {OUTCOMES.map(({ key: outcome }, column) => {
                const on = outcomes[key][outcome];
                // A row's marks in the signature, then the space after them.
                const flash = turned.has(String(row * (OUTCOMES.length + 1) + column));
                return (
                  <td key={outcome}>
                    <span
                      key={flash ? seen.turn : 0}
                      className={flash ? "nt-mark changed" : "nt-mark"}
                      data-on={on}
                      aria-hidden="true"
                    >
                      {on ? <Icon name="check" size={14} /> : null}
                    </span>
                    <span className="sr-only">
                      {t(on ? "notifications.stage.yes" : "notifications.stage.no")}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The permission says what the row can offer. Before the device was asked
 * there is nothing to switch, only something to allow; once it is blocked the
 * way back is outside the app, and the row says where.
 */
function SystemRow({
  preferences,
  system,
}: {
  preferences: UserPreferences;
  system: SystemNotificationPreferenceProps;
}) {
  const { t } = useLanguage();
  const label = t("preference.desktopNotifications");
  const lead = t(
    system.mentions
      ? "preference.desktopNotificationsDetail"
      : "preference.desktopNotificationsCallsDetail",
  );

  let detail = lead;
  let control: ReactNode = null;
  if (!system.supported || system.permission === "unsupported") {
    detail = t("preference.desktopNotificationsUnsupported");
  } else if (system.permission === "denied") {
    detail = t("preference.desktopNotificationsDenied");
    control = (
      <span className="nt-state">
        <Icon name="lock" size={15} />
        {t("preference.desktopNotificationsBlocked")}
      </span>
    );
  } else if (system.permission === "default") {
    detail = `${lead} ${t("preference.desktopNotificationsAsk")}`;
    control = (
      <Button
        type="button"
        size="sm"
        aria-label={t("preference.desktopNotificationsAllowLabel")}
        disabled={system.pending}
        onClick={() => system.onChange(true)}
      >
        <Icon name="bell" size={15} />
        {t("preference.desktopNotificationsAllow")}
      </Button>
    );
  } else {
    const on = preferences.desktopNotifications;
    control = (
      <>
        {on && system.onTest ? (
          <Button type="button" variant="quiet" size="sm" onClick={system.onTest}>
            {t("preference.desktopNotificationsTest")}
          </Button>
        ) : null}
        <Switch checked={on} onChange={system.onChange} label={label} disabled={system.pending} />
      </>
    );
  }

  return (
    <div className={control === null ? "frm-row nt-solo" : "frm-row"}>
      <span className="frm-lab">
        {label}
        <span>{detail}</span>
        {system.error ? (
          <span className="frm-detail-error" role="alert">
            {t("preference.desktopNotificationsFailed")}
          </span>
        ) : null}
      </span>
      {control === null ? null : <div className="frm-ctl frm-switch nt-ctl">{control}</div>}
    </div>
  );
}

/**
 * The channels you muted on the server in view, and the one way back. Muting
 * happens where the channel is, in its menu; this is where you find them again
 * once they have gone quiet, the way the privacy pane lists the people you
 * blocked.
 */
function MutedCard({ serverName, channels, elsewhere, onUnmute }: MutedChannelsProps) {
  const { t } = useLanguage();
  return (
    <section className="sc acc-security nt-muted">
      <header className="sc-h">{t("preference.muted")}</header>
      <div className="sc-b acc-security-list">
        {channels.length === 0 ? (
          <p className="acc-security-item acc-security-empty">
            {t("preference.mutedEmpty", { server: serverName })}
          </p>
        ) : (
          channels.map((channel) => (
            <div className="acc-security-item" key={channel.id}>
              <div className="acc-security-summary acc-blocked">
                <span className="acc-security-copy">
                  <b>
                    <span className="nt-hash" aria-hidden="true">#</span>
                    {channel.name}
                  </b>
                  {channel.section ? <small>{channel.section}</small> : null}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={t("preference.unmuteChannel", { channel: channel.name })}
                  onClick={() => onUnmute(channel.id)}
                >
                  {t("preference.unmute")}
                </Button>
              </div>
            </div>
          ))
        )}
        <p className="nt-note">
          {t("preference.mutedNote")}
          {elsewhere > 0 ? ` ${t("preference.mutedElsewhere", { count: elsewhere })}` : null}
        </p>
      </div>
    </section>
  );
}

/**
 * Which events interrupt you, and how.
 *
 * It opens on what reaches you, then the three things that decide it: the
 * pop-ups, which are the device's permission as much as a preference; the
 * message sound, one choice of three, since "off" and "for what" were two
 * controls for one question; and the muted channels, which were set in the
 * channel list and never seen again. Everything but the permission is stored
 * on the account and follows the person to every device.
 */
export function UserNotificationsPane({
  preferences,
  onChange,
  systemNotifications,
  muted,
  onPlaySound,
}: UserNotificationsPaneProps) {
  const { t } = useLanguage();

  const choose = (choice: SoundChoice) => {
    if (choice === "off") onChange({ messageSound: false });
    else onChange({ messageSound: true, mentionsOnly: choice === "mentions" });
  };

  return (
    <>
      <Stage outcomes={outcomesOf(preferences, systemNotifications)} />

      {systemNotifications === undefined ? null : (
        <section className="sc">
          <header className="sc-h">{t("preference.popups")}</header>
          <div className="sc-b">
            <div className="frm">
              <SystemRow preferences={preferences} system={systemNotifications} />
            </div>
          </div>
        </section>
      )}

      <section className="sc nt-sound">
        <header className="sc-h nt-h">
          {t("preference.messageSound")}
          {onPlaySound ? (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              aria-label={t("preference.messageSoundPlayLabel")}
              onClick={onPlaySound}
            >
              <Icon name="play" size={15} />
              {t("preference.messageSoundPlay")}
            </Button>
          ) : null}
        </header>
        <div className="sc-b">
          <div className="frm">
            <div className="frm-row">
              <span className="frm-lab">
                {t("preference.messageSoundFor")}
                <span>{t("preference.messageSoundForDetail")}</span>
              </span>
              <div className="frm-ctl">
                <Segmented
                  className="nt-sound-choice"
                  label={t("preference.messageSoundFor")}
                  value={soundChoice(preferences)}
                  onChange={choose}
                  options={[
                    {
                      value: "mentions",
                      label: t("preference.soundMentions"),
                      detail: t("preference.soundMentionsDetail"),
                    },
                    {
                      value: "all",
                      label: t("preference.soundAll"),
                      detail: t("preference.soundAllDetail"),
                    },
                    {
                      value: "off",
                      label: t("preference.soundOff"),
                      detail: t("preference.soundOffDetail"),
                    },
                  ]}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {muted === undefined ? null : <MutedCard {...muted} />}
    </>
  );
}
