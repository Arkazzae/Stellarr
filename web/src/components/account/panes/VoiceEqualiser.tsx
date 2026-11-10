"use client";

import { useId } from "react";

import type { MessageKey } from "@/i18n";
import { PLAYBACK_EQ_MAX_DB, PLAYBACK_EQ_MIN_DB, PLAYBACK_EQ_STEP_DB } from "@/ports";
import type { PlaybackTuning } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { RangeField, formatDb } from "./VoiceFields";

type Band = Exclude<keyof PlaybackTuning, "compression">;

const BANDS: readonly { field: Band; label: MessageKey; hint: MessageKey }[] = [
  { field: "warmthDb", label: "voice.eq.warmth", hint: "voice.eq.warmthHint" },
  { field: "mudDb", label: "voice.eq.mud", hint: "voice.eq.mudHint" },
  { field: "presenceDb", label: "voice.eq.presence", hint: "voice.eq.presenceHint" },
  { field: "airDb", label: "voice.eq.air", hint: "voice.eq.airHint" },
];

export interface VoiceEqualiserProps {
  tuning: PlaybackTuning;
  onChange: (field: keyof PlaybackTuning, value: number) => void;
}

/** Four tone bands in decibels and the strength of the compressor. */
export function VoiceEqualiser({ tuning, onChange }: VoiceEqualiserProps) {
  const { t } = useLanguage();
  const id = useId();

  return (
    <div className="frm-row">
      <span className="frm-lab">
        {t("voice.eq.title")}
        <span>{t("voice.eq.detail")}</span>
      </span>
      <div className="frm-ctl voice-eq-grid" role="group" aria-label={t("voice.eq.title")}>
        {BANDS.map(({ field, label, hint }) => (
          <EqualiserControl
            key={field}
            id={`${id}-${field}`}
            label={t(label)}
            detail={t(hint)}
            min={PLAYBACK_EQ_MIN_DB}
            max={PLAYBACK_EQ_MAX_DB}
            step={PLAYBACK_EQ_STEP_DB}
            value={tuning[field]}
            display={formatDb(tuning[field])}
            onChange={(value) => onChange(field, value)}
          />
        ))}
        <EqualiserControl
          wide
          id={`${id}-compression`}
          label={t("voice.eq.compression")}
          detail={t("voice.eq.compressionHint")}
          min={0}
          max={100}
          step={5}
          value={tuning.compression}
          display={`${tuning.compression}%`}
          onChange={(value) => onChange("compression", value)}
        />
      </div>
    </div>
  );
}

interface EqualiserControlProps {
  id: string;
  label: string;
  detail: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  wide?: boolean;
  onChange: (value: number) => void;
}

function EqualiserControl({ id, label, detail, wide = false, ...range }: EqualiserControlProps) {
  return (
    <label className={wide ? "voice-eq-control wide" : "voice-eq-control"} htmlFor={id}>
      <span className="voice-eq-copy">
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <RangeField id={id} {...range} />
    </label>
  );
}
