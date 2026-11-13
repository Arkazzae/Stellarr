"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { SettingsSection } from "@/components/settings/SettingsSection";
import {
  channelIcon,
  channelLabel,
  type ChannelSettingsVM,
} from "@/components/settings/channelSettingsModel";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { MessageKey } from "@/i18n";
import type { ChannelKind, ChannelPatch } from "@/ports";
import { useLanguage } from "@/state/hooks";

const SAVED_FLASH_MS = 1500;

/** The slow-mode steps, in the words this app uses. 0 is off. */
const SLOW_MODE: readonly { seconds: number; label: MessageKey }[] = [
  { seconds: 0, label: "channel.slowMode.off" },
  { seconds: 5, label: "channel.slowMode.5" },
  { seconds: 10, label: "channel.slowMode.10" },
  { seconds: 30, label: "channel.slowMode.30" },
  { seconds: 60, label: "channel.slowMode.60" },
  { seconds: 300, label: "channel.slowMode.300" },
  { seconds: 900, label: "channel.slowMode.900" },
  { seconds: 3600, label: "channel.slowMode.3600" },
];

/** How long a quiet channel stays in the rail. 0 means "always". */
const HIDE_AFTER: readonly { hours: number; label: MessageKey }[] = [
  { hours: 0, label: "channel.hideAfter.0" },
  { hours: 1, label: "channel.hideAfter.1" },
  { hours: 24, label: "channel.hideAfter.24" },
  { hours: 72, label: "channel.hideAfter.72" },
  { hours: 168, label: "channel.hideAfter.168" },
];

/** How many people the call takes. 0 means no limit. */
const USER_LIMITS: readonly number[] = [0, 2, 4, 6, 8, 10, 16, 25, 50];

export interface ChannelIdentityProps {
  kind: ChannelKind;
  /** The name as the rail writes it. */
  name: string;
  /** The line under the name: the kind and where the channel sits. */
  meta: string;
}

/**
 * The channel as the rail will show it, at the top of the profile card. It is
 * the server overview's identity row, with the kind's mark in place of the
 * server icon.
 */
export function ChannelIdentity({ kind, name, meta }: ChannelIdentityProps) {
  return (
    <header className="ov-id ch-id">
      <span className="ch-id-ico" aria-hidden="true">
        <Icon name={channelIcon(kind)} size={20} />
      </span>
      <span className="ov-id-txt">
        <b>{name}</b>
        <span>{meta}</span>
      </span>
    </header>
  );
}

/** The settings that shape how a channel behaves, beside its name. */
export interface ChannelBehaviour {
  topic: string;
  slowModeSeconds: number;
  hideAfterInactivityHours: number;
  userLimit: number;
}

export interface ChannelBehaviourRowsProps {
  kind: ChannelKind;
  value: ChannelBehaviour;
  onChange: (part: Partial<ChannelBehaviour>) => void;
  disabled: boolean;
}

/**
 * The form rows for a channel's behaviour: topic and slow mode for a text
 * channel, the person limit for a voice one, and when it leaves the rail.
 */
export function ChannelBehaviourRows({ kind, value, onChange, disabled }: ChannelBehaviourRowsProps) {
  const { t } = useLanguage();
  const topicId = useId();
  const slowId = useId();
  const limitId = useId();
  const hideId = useId();

  return (
    <>
      {kind === "voice" ? (
        <div className="frm-row">
          <label className="frm-lab" htmlFor={limitId}>
            {t("channel.personLimit")}
            <span>{t("channel.personLimitDetail")}</span>
          </label>
          <div className="frm-ctl">
            <select
              id={limitId}
              className="set-input"
              value={value.userLimit}
              disabled={disabled}
              onChange={(event) => onChange({ userLimit: Number(event.target.value) })}
            >
              {USER_LIMITS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit === 0
                    ? t("channel.unlimited")
                    : t("channel.personLimitValue", { count: limit })}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <>
          <div className="frm-row">
            <label className="frm-lab" htmlFor={topicId}>
              {t("channel.topic")}
              <span>{t("channel.topicDetail")}</span>
            </label>
            <div className="frm-ctl">
              <textarea
                id={topicId}
                className="set-area"
                placeholder={t("channel.topicPlaceholder")}
                value={value.topic}
                maxLength={280}
                disabled={disabled}
                onChange={(event) => onChange({ topic: event.target.value })}
              />
            </div>
          </div>

          <div className="frm-row">
            <label className="frm-lab" htmlFor={slowId}>
              {t("channel.slowMode")}
              <span>{t("channel.slowModeDetail")}</span>
            </label>
            <div className="frm-ctl">
              <select
                id={slowId}
                className="set-input"
                value={value.slowModeSeconds}
                disabled={disabled}
                onChange={(event) => onChange({ slowModeSeconds: Number(event.target.value) })}
              >
                {SLOW_MODE.map((step) => (
                  <option key={step.seconds} value={step.seconds}>
                    {t(step.label)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      <div className="frm-row">
        <label className="frm-lab" htmlFor={hideId}>
          {t("channel.hideAfterInactivity")}
          <span>{t("channel.hideAfterInactivityDetail")}</span>
        </label>
        <div className="frm-ctl">
          <select
            id={hideId}
            className="set-input"
            value={value.hideAfterInactivityHours}
            disabled={disabled}
            onChange={(event) =>
              onChange({ hideAfterInactivityHours: Number(event.target.value) })
            }
          >
            {HIDE_AFTER.map((step) => (
              <option key={step.hours} value={step.hours}>
                {t(step.label)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

interface Draft extends ChannelBehaviour {
  name: string;
}

const draftOf = (channel: ChannelSettingsVM): Draft => ({
  name: channel.name,
  topic: channel.topic,
  slowModeSeconds: channel.slowModeSeconds,
  hideAfterInactivityHours: channel.hideAfterInactivityHours,
  userLimit: channel.userLimit,
});

const sameDraft = (a: Draft, b: Draft) =>
  a.name === b.name &&
  a.topic === b.topic &&
  a.slowModeSeconds === b.slowModeSeconds &&
  a.hideAfterInactivityHours === b.hideAfterInactivityHours &&
  a.userLimit === b.userLimit;

export interface ChannelOverviewPaneProps {
  channel: ChannelSettingsVM;
  supported: boolean;
  onSave: (patch: ChannelPatch) => Promise<void>;
}

/**
 * Everything a channel is called and how it behaves, in one card with its own
 * save, the way the server overview keeps the server's profile.
 */
export function ChannelOverviewPane({ channel, supported, onSave }: ChannelOverviewPaneProps) {
  const { t } = useLanguage();
  const saveAction = useAsyncAction();
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);
  const nameId = useId();
  const voice = channel.kind === "voice";

  // Typing needs no round trip, so the fields are a local draft. It is re-seeded
  // when the saved channel changes underneath: another channel, or this one
  // after a save. Comparing during render paints the new fields in one pass.
  const current = draftOf(channel);
  const [draft, setDraft] = useState(current);
  const [seed, setSeed] = useState(current);
  if (!sameDraft(seed, current)) {
    setSeed(current);
    setDraft(current);
  }

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const patch = (part: Partial<Draft>) => setDraft((value) => ({ ...value, ...part }));

  // Disabled until something changed: a button that is always live cannot tell
  // the reader whether they have unsaved work.
  const dirty =
    draft.name.trim() !== channel.name ||
    draft.hideAfterInactivityHours !== channel.hideAfterInactivityHours ||
    (voice
      ? draft.userLimit !== channel.userLimit
      : draft.topic.trim() !== channel.topic || draft.slowModeSeconds !== channel.slowModeSeconds);

  const save = async () => {
    const stored = await saveAction.run(() =>
      onSave({
        name: draft.name.trim(),
        hideAfterInactivityHours: draft.hideAfterInactivityHours,
        ...(voice
          ? { userLimit: draft.userLimit }
          : { topic: draft.topic.trim(), slowModeSeconds: draft.slowModeSeconds }),
      }),
    );
    if (!stored) return;
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  };

  const kindLabel = voice ? t("channel.voice") : t("channel.text");

  return (
    <SettingsSection
      title={t("channel.profile")}
      icon={channelIcon(channel.kind)}
      className="overview-section"
    >
      <ChannelIdentity
        kind={channel.kind}
        name={channelLabel(channel.kind, channel.name)}
        meta={`${kindLabel} · ${channel.sectionName ?? t("channel.unsectioned")}`}
      />

      <div className="frm">
        <div className="frm-row">
          <label className="frm-lab" htmlFor={nameId}>
            {t("channel.name")}
            <span>{t("channel.nameDetail")}</span>
          </label>
          <div className="frm-ctl">
            <input
              id={nameId}
              className="set-input"
              type="text"
              value={draft.name}
              maxLength={60}
              disabled={!supported}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>
        </div>

        <ChannelBehaviourRows
          kind={channel.kind}
          value={draft}
          onChange={patch}
          disabled={!supported}
        />
      </div>

      <div className="frm-actions">
        {saveAction.failed ? (
          <p className="set-note sound-error" role="alert">
            {t("channel.settingsSaveFailed")}
          </p>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          disabled={!supported || !dirty || saveAction.pending}
          onClick={() => void save()}
        >
          {saved ? (
            <span className="sv-tick" aria-hidden="true">
              <Icon name="tick" size={15} />
            </span>
          ) : null}
          {saveAction.pending
            ? t("common.saving")
            : saved
              ? t("common.saved")
              : t("common.saveChanges")}
        </button>
      </div>
    </SettingsSection>
  );
}
