"use client";

import { useEffect, useId, useRef } from "react";

import { Icon } from "@/components/icons/Icon";
import { ErrorNotice } from "@/components/primitives/ErrorNotice";
import {
  INPUT_GAIN_MAX_DB,
  INPUT_GAIN_MIN_DB,
  INPUT_GAIN_STEP_DB,
} from "@/ports";
import type { MicTest, VoiceSettings } from "@/ports";
import { useLanguage } from "@/state/hooks";

import {
  DeviceSelect,
  FormRow,
  RangeField,
  SwitchRow,
  VoiceSection,
  formatDb,
} from "./VoiceFields";

export interface VoiceMicrophoneSectionProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  /** Persists the already-applied sensitivity in the signed-in account. */
  onVadCommit: (value: number) => void;
  mic: MicTest;
}

/**
 * Which microphone, whether it works, and how loud speech has to be.
 *
 * Sensitivity and gain sit under the level meter they are judged against: "is
 * it loud enough" and "is it speech" are two questions the one bar answers.
 */
export function VoiceMicrophoneSection({
  settings,
  onChange,
  onVadCommit,
  mic,
}: VoiceMicrophoneSectionProps) {
  const { t } = useLanguage();
  const deviceId = useId();
  const vadId = useId();
  const gainId = useId();

  // The sensitivity is applied on every step but saved to the account when the
  // gesture ends. By then the parent may not have re-rendered with the last
  // step, so the value being dragged is kept here rather than read from props.
  const draggedVad = useRef(settings.vadSensitivity);
  useEffect(() => {
    draggedVad.current = settings.vadSensitivity;
  }, [settings.vadSensitivity]);

  return (
    <VoiceSection icon="mic" title={t("voice.microphone")}>
      <div className="frm">
        <FormRow
          label={t("voice.device")}
          detail={t("voice.deviceImmediateDetail")}
          htmlFor={deviceId}
        >
          <DeviceSelect
            id={deviceId}
            label={t("voice.microphone")}
            devices={mic.devices}
            value={settings.inputDeviceId}
            defaultLabel={t("voice.systemDefault")}
            onChange={(inputDeviceId) => onChange({ inputDeviceId })}
          />
          {/* Before permission the browser hands out entries with empty
              labels, so the list is numbered and says why. */}
          {mic.labelsKnown ? null : (
            <p className="pf-count">{t("voice.microphoneNamesHint")}</p>
          )}
          {/* The system default names a rule, not a microphone. While the test
              is open the rule has picked one, and that is the part people are
              surprised by. */}
          {settings.inputDeviceId === null && mic.activeDeviceLabel !== null ? (
            <p className="pf-count">
              {t("voice.currentDevice", { device: mic.activeDeviceLabel })}
            </p>
          ) : null}
        </FormRow>

        <FormRow label={t("voice.test")} detail={t("voice.testDetail")}>
          <MicrophoneCheck mic={mic} />
        </FormRow>

        <FormRow
          label={t("voice.speechSensitivity")}
          detail={t("voice.speechSensitivityDetail")}
          htmlFor={vadId}
        >
          <RangeField
            id={vadId}
            min={0}
            max={100}
            step={5}
            value={settings.vadSensitivity}
            display={String(settings.vadSensitivity)}
            onChange={(vadSensitivity) => {
              draggedVad.current = vadSensitivity;
              onChange({ vadSensitivity });
            }}
            onRelease={() => onVadCommit(draggedVad.current)}
          />
        </FormRow>

        <FormRow
          label={t("voice.inputGain")}
          detail={t("voice.inputGainDetail")}
          htmlFor={gainId}
        >
          <RangeField
            id={gainId}
            min={INPUT_GAIN_MIN_DB}
            max={INPUT_GAIN_MAX_DB}
            step={INPUT_GAIN_STEP_DB}
            value={settings.inputGainDb}
            display={formatDb(settings.inputGainDb)}
            onChange={(inputGainDb) => onChange({ inputGainDb })}
          />
        </FormRow>

        <SwitchRow
          label={t("voice.inputGate")}
          detail={t("voice.inputGateDetail")}
          checked={settings.inputGate}
          onChange={(inputGate) => onChange({ inputGate })}
        />
        {/* A switch that is on while the browser cannot build the gate would
            be a lie, the same as the suppressor line further down. */}
        {settings.inputGate && mic.gateActive === false ? (
          <p className="acc-answer bad mic-truth" role="status">
            {t("voice.inputGateUnavailable")}
          </p>
        ) : null}
      </div>
    </VoiceSection>
  );
}

function MicrophoneCheck({ mic }: { mic: MicTest }) {
  const { t } = useLanguage();
  const level = Math.round(mic.level * 100);

  let status = "";
  if (mic.error === null) {
    if (!mic.running) status = t("voice.testOff");
    else status = mic.speaking ? t("voice.hearYou") : t("voice.silence");
  }

  return (
    <>
      <div className="mic-test">
        <button
          type="button"
          className={mic.running ? "btn-ghost sm on" : "btn-ghost sm"}
          disabled={mic.starting}
          onClick={() => (mic.running ? mic.stop() : mic.start())}
        >
          <Icon name={mic.running ? "pause" : "mic"} size={15} />
          {mic.running
            ? t("voice.stop")
            : mic.starting
              ? t("voice.opening")
              : t("voice.checkMicrophone")}
        </button>
        {/* One bar rather than a row of blocks: the number that matters is how
            close the level is to the line the detector draws, and `speaking`
            is where that line landed. */}
        <div
          className={mic.speaking ? "mic-bar live" : "mic-bar"}
          role="meter"
          aria-label={t("voice.microphoneLevel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level}
        >
          <i style={{ width: `${level}%` }} />
          {/* The detector publishes in eighths, so without a mark that holds
              the loudest moment, one loud syllable is a frame you miss. */}
          {mic.peak > 0 ? <u style={{ left: `${Math.round(mic.peak * 100)}%` }} /> : null}
        </div>
      </div>
      <p className="pf-count" role="status">
        {status}
      </p>
      {mic.error === null ? null : (
        <ErrorNotice
          compact
          title={t("voice.microphoneNotWorking")}
          message={mic.error}
          icon="micSlash"
          actions={[{ label: t("common.tryAgain"), onClick: mic.start }]}
        />
      )}
    </>
  );
}
