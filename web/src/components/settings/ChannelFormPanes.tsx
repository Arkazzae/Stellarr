"use client";

import { useId } from "react";

import { SettingsSection } from "@/components/settings/SettingsSection";
import type { ChannelSettingsVM } from "@/components/settings/channelSettingsModel";
import type { MessageKey, Translator } from "@/i18n";

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

export interface ChannelFormPaneProps {
  current: ChannelSettingsVM | null;
  supported: boolean;
  patch: (part: Partial<ChannelSettingsVM>) => void;
  t: Translator;
}

export function GeneralPane({ current, supported, patch, t }: ChannelFormPaneProps) {
  const nameId = useId();
  const topicId = useId();
  const slowId = useId();
  const hideId = useId();
  const text = current?.kind !== "voice";

  return (
    <SettingsSection
      title={text ? t("channel.text") : t("channel.voice")}
      icon={text ? "hash" : "speaker"}
      bodyClassName="ch-settings-form"
    >
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
              value={current?.name ?? ""}
              maxLength={60}
              disabled={!supported}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>
        </div>

        {text ? (
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
                  value={current?.topic ?? ""}
                  maxLength={280}
                  disabled={!supported}
                  onChange={(event) => patch({ topic: event.target.value })}
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
                  value={current?.slowModeSeconds ?? 0}
                  disabled={!supported}
                  onChange={(event) => patch({ slowModeSeconds: Number(event.target.value) })}
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
        ) : null}

        <div className="frm-row">
          <label className="frm-lab" htmlFor={hideId}>
            {t("channel.hideAfterInactivity")}
            <span>{t("channel.hideAfterInactivityDetail")}</span>
          </label>
          <div className="frm-ctl">
            <select
              id={hideId}
              className="set-input"
              value={current?.hideAfterInactivityHours ?? 0}
              disabled={!supported}
              onChange={(event) =>
                patch({ hideAfterInactivityHours: Number(event.target.value) })
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
      </div>
    </SettingsSection>
  );
}

export function VoicePane({ current, supported, patch, t }: ChannelFormPaneProps) {
  const limitId = useId();

  return (
    <SettingsSection
      title={t("settings.voiceVideo")}
      icon="headphones"
      bodyClassName="ch-settings-form"
    >
      <div className="frm">
        <div className="frm-row">
          <label className="frm-lab" htmlFor={limitId}>
            {t("channel.personLimit")}
            <span>{t("channel.personLimitDetail")}</span>
          </label>
          <div className="frm-ctl">
            <select
              id={limitId}
              className="set-input"
              value={current?.userLimit ?? 0}
              disabled={!supported}
              onChange={(event) => patch({ userLimit: Number(event.target.value) })}
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
      </div>
    </SettingsSection>
  );
}
