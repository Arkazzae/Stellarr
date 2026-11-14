"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import type { MessageKey } from "@/i18n";
import type { UserPreferences } from "@/ports";
import { useLanguage } from "@/state/hooks";

import type { PreferencePaneProps } from "./PreferencePanes";

/** The two pop-up switches: calls (`desktopNotifications`) and mentions. */
export type PopupPatch = Partial<Pick<UserPreferences, "desktopNotifications" | "mentionPopups">>;

/** System notifications are a device permission as well as stored preferences. */
export interface SystemNotificationPreferenceProps {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  pending: boolean;
  error: boolean;
  /**
   * Whether a mention can pop up here as well as a call. The Android app's
   * bridge rings calls only, so there a mention stays in the app.
   */
  mentions: boolean;
  /** Asks the device for its permission. */
  onAllow(): void;
  /**
   * Turns call or mention pop-ups on or off. Turning one on where the device
   * was not asked yet asks it first, and stores the switch only once it agrees.
   */
  onChange(patch: PopupPatch): void;
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
  /**
   * Whether this app plays the call ringtone itself. Inside the Android app
   * the system rings, and a switch here would change nothing there.
   */
  ringtone?: boolean;
}

type Outcome = "sound" | "popup" | "inbox";
type Example = "call" | "mention" | "message" | "muted";

/**
 * One cell of the table. A switch is a setting of its own; a fact is how the
 * app works, and it says why when asked.
 */
type Cell =
  | { kind: "switch"; on: boolean; disabled: boolean; toggle: () => void }
  | { kind: "fact"; on: boolean; reason: MessageKey };

type Cells = Record<Example, Record<Outcome, Cell>>;

const OUTCOMES: readonly { key: Outcome; icon: IconName; label: MessageKey }[] = [
  { key: "sound", icon: "sound", label: "notifications.stage.sound" },
  { key: "popup", icon: "monitor", label: "notifications.stage.popup" },
  // The bell, because that is the button the inbox opens from.
  { key: "inbox", icon: "bell", label: "notifications.stage.inbox" },
];

const fact = (on: boolean, reason: MessageKey): Cell => ({ kind: "fact", on, reason });

/**
 * Every cell, from the settings as they stand. It restates the rules the app
 * follows (`shouldPlayMessageNotificationSound`, the incoming call's ringtone
 * and pop-up, `shouldShowMentionNotification`, the server's mention inbox), so
 * a change to one of them belongs here too.
 *
 * The two sound switches share the stored pair `messageSound`/`mentionsOnly`,
 * so they follow one rule: every message includes the mentions. Turning the
 * message sound on turns the mention sound on with it, and turning the mention
 * sound off silences both.
 */
function cellsOf(
  preferences: UserPreferences,
  onChange: (patch: Partial<UserPreferences>) => void,
  system: SystemNotificationPreferenceProps | undefined,
  ringtone: boolean,
): Cells {
  const popup = (key: keyof PopupPatch): Cell => {
    if (system === undefined || !system.supported || system.permission === "unsupported") {
      return fact(false, "notifications.stage.popupUnsupported");
    }
    if (system.permission === "denied") return fact(false, "notifications.stage.popupBlocked");
    if (key === "mentionPopups" && !system.mentions) {
      return fact(false, "notifications.stage.popupCallsOnly");
    }
    // Before the device agreed nothing pops up, whatever the account says.
    const on = system.permission === "granted" && preferences[key];
    return {
      kind: "switch",
      on,
      disabled: system.pending,
      toggle: () => system.onChange({ [key]: !on }),
    };
  };

  const mentionSound = preferences.messageSound;
  const messageSound = preferences.messageSound && !preferences.mentionsOnly;

  return {
    call: {
      sound: ringtone
        ? {
            kind: "switch",
            on: preferences.callRingtone,
            disabled: false,
            toggle: () => onChange({ callRingtone: !preferences.callRingtone }),
          }
        : fact(true, "notifications.stage.ringtoneSystem"),
      popup: popup("desktopNotifications"),
      inbox: fact(false, "notifications.stage.inboxNever"),
    },
    mention: {
      sound: {
        kind: "switch",
        on: mentionSound,
        disabled: false,
        toggle: () =>
          onChange(mentionSound ? { messageSound: false } : { messageSound: true, mentionsOnly: true }),
      },
      popup: popup("mentionPopups"),
      inbox: fact(true, "notifications.stage.inboxAlways"),
    },
    message: {
      sound: {
        kind: "switch",
        on: messageSound,
        disabled: false,
        toggle: () =>
          onChange(messageSound ? { mentionsOnly: true } : { messageSound: true, mentionsOnly: false }),
      },
      popup: fact(false, "notifications.stage.popupMentionsOnly"),
      inbox: fact(false, "notifications.stage.inboxNever"),
    },
    // Muting silences a channel in this app; the server still files the mention.
    muted: {
      sound: fact(false, "notifications.stage.mutedQuiet"),
      popup: fact(false, "notifications.stage.mutedQuiet"),
      inbox: fact(true, "notifications.stage.inboxAlways"),
    },
  };
}

function signature(cells: Cells): string {
  return Object.values(cells)
    .map((row) => OUTCOMES.map(({ key }) => (row[key].on ? "1" : "0")).join(""))
    .join(" ");
}

/**
 * What reaches you: four everyday events and, for each, whether it makes a
 * sound, pops up over other apps and lands in the inbox. It is the pane's
 * control as well as its summary. A circle is a switch; a bare tick or rule
 * is how the app works, and says why on hover. A cell a change has just
 * turned over answers once, so a switch that moves another one shows it.
 */
function Stage({ cells, onPlaySound }: { cells: Cells; onPlaySound?: () => void }) {
  const { t } = useLanguage();
  const current = signature(cells);
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
              {OUTCOMES.map(({ key: outcome, label }, column) => {
                const cell = cells[key][outcome];
                // A row's marks in the signature, then the space after them.
                const flash = turned.has(String(row * (OUTCOMES.length + 1) + column));
                const className = ["nt-mark", cell.kind === "switch" ? "nt-switch" : "nt-fact", flash ? "changed" : ""]
                  .filter(Boolean)
                  .join(" ");
                const tick = cell.on ? <Icon name="check" size={14} /> : null;
                return (
                  <td key={outcome}>
                    {cell.kind === "switch" ? (
                      <button
                        key={flash ? seen.turn : 0}
                        type="button"
                        role="switch"
                        aria-checked={cell.on}
                        aria-label={`${t(label)}: ${title}`}
                        className={className}
                        data-on={cell.on}
                        disabled={cell.disabled}
                        onClick={cell.toggle}
                      >
                        {tick}
                      </button>
                    ) : (
                      <>
                        <span
                          key={flash ? seen.turn : 0}
                          className={className}
                          data-on={cell.on}
                          title={t(cell.reason)}
                          aria-hidden="true"
                        >
                          {tick}
                        </span>
                        <span className="sr-only">
                          {t(cell.on ? "notifications.stage.yes" : "notifications.stage.no")}.{" "}
                          {t(cell.reason)}
                        </span>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="nt-stage-foot">
        <p>{t("notifications.stage.hint")}</p>
        {onPlaySound ? (
          <Button type="button" variant="quiet" size="sm" onClick={onPlaySound}>
            <Icon name="play" size={15} />
            {t("preference.messageSoundPlayLabel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The device's side of the pop-ups. The table decides what pops up; this row
 * says whether anything can: before the device was asked there is something to
 * allow, once it agreed there is a test, and once it refused the way back is
 * outside the app and the row says where.
 */
function SystemRow({ system }: { system: SystemNotificationPreferenceProps }) {
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
        onClick={system.onAllow}
      >
        <Icon name="bell" size={15} />
        {t("preference.desktopNotificationsAllow")}
      </Button>
    );
  } else {
    detail = t("preference.desktopNotificationsAllowed");
    control = system.onTest ? (
      <Button type="button" variant="secondary" size="sm" onClick={system.onTest}>
        {t("preference.desktopNotificationsTest")}
      </Button>
    ) : null;
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
 * The table of what reaches you is where it is set: a cell that is a setting
 * of its own is a switch in place, so a choice and its consequence are the
 * same thing on screen. Below it is only what a table cannot say: whether the
 * device allows pop-ups at all, and the muted channels, which were set in the
 * channel list and never seen again. Everything but the device's permission is
 * stored on the account and follows the person to every device.
 */
export function UserNotificationsPane({
  preferences,
  onChange,
  systemNotifications,
  muted,
  onPlaySound,
  ringtone = true,
}: UserNotificationsPaneProps) {
  const { t } = useLanguage();

  return (
    <>
      <Stage
        cells={cellsOf(preferences, onChange, systemNotifications, ringtone)}
        onPlaySound={onPlaySound}
      />

      {systemNotifications === undefined ? null : (
        <section className="sc">
          <header className="sc-h">{t("preference.popups")}</header>
          <div className="sc-b">
            <div className="frm">
              <SystemRow system={systemNotifications} />
            </div>
          </div>
        </section>
      )}

      {muted === undefined ? null : <MutedCard {...muted} />}
    </>
  );
}
