"use client";

import type { ReactNode } from "react";

import { Icon, type IconName } from "@stellarr/ui/icons";
import { Switch } from "@/components/primitives/Switch";
import type { MediaDeviceChoice } from "@/ports";

/** The reading beside a decibel slider: signed, so a cut is as visible as a boost. */
export function formatDb(value: number): string {
  return `${value > 0 ? "+" : ""}${value} dB`;
}

export interface VoiceSectionProps {
  icon: IconName;
  iconSize?: number;
  title: string;
  children: ReactNode;
}

/** One headed card of the voice pane. */
export function VoiceSection({ icon, iconSize = 17, title, children }: VoiceSectionProps) {
  return (
    <section className="sc">
      <header className="sc-h">
        <span className="sc-ico" aria-hidden="true">
          <Icon name={icon} size={iconSize} />
        </span>
        {title}
      </header>
      <div className="sc-b">{children}</div>
    </section>
  );
}

export interface FormRowProps {
  label: string;
  detail: string;
  /** Id of the control this row labels; without one the label is plain text. */
  htmlFor?: string;
  /** Extra class for the control column, such as `frm-switch`. */
  controlClass?: string;
  children: ReactNode;
}

/** A label with its explanation on the left, the control on the right. */
export function FormRow({ label, detail, htmlFor, controlClass, children }: FormRowProps) {
  const text = (
    <>
      {label}
      <span>{detail}</span>
    </>
  );
  return (
    <div className="frm-row">
      {htmlFor === undefined ? (
        <span className="frm-lab">{text}</span>
      ) : (
        <label className="frm-lab" htmlFor={htmlFor}>
          {text}
        </label>
      )}
      <div className={controlClass ? `frm-ctl ${controlClass}` : "frm-ctl"}>{children}</div>
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function SwitchRow({ label, detail, checked, onChange }: SwitchRowProps) {
  return (
    <FormRow label={label} detail={detail} controlClass="frm-switch">
      <Switch checked={checked} onChange={onChange} label={label} />
    </FormRow>
  );
}

export interface RangeFieldProps {
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** The reading shown beside the slider. */
  display: string;
  /** Names the slider when no visible label points at it. */
  label?: string;
  onChange: (value: number) => void;
  /** The adjustment is over: the pointer lifted, a key was released or focus left. */
  onRelease?: () => void;
}

export function RangeField({
  id,
  min,
  max,
  step,
  value,
  display,
  label,
  onChange,
  onRelease,
}: RangeFieldProps) {
  return (
    <span className="vad-row">
      <input
        id={id}
        className="vad-range"
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        onBlur={onRelease}
      />
      <output className="vad-value" htmlFor={id}>
        {display}
      </output>
    </span>
  );
}

export interface DeviceSelectProps {
  id: string;
  /** Names the select for assistive technology, and for the tests. */
  label: string;
  devices: readonly MediaDeviceChoice[];
  /** `null` is the system default. */
  value: string | null;
  defaultLabel: string;
  disabled?: boolean;
  title?: string;
  onChange: (deviceId: string | null) => void;
}

/**
 * A device list whose first entry is the system default.
 *
 * The default is stored as `null` rather than an empty id, so unplugging the
 * chosen device falls back to whatever the system picks instead of to an id
 * that no longer exists.
 */
export function DeviceSelect({
  id,
  label,
  devices,
  value,
  defaultLabel,
  disabled,
  title,
  onChange,
}: DeviceSelectProps) {
  return (
    <select
      id={id}
      className="set-select"
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      title={title}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    >
      <option value="">{defaultLabel}</option>
      {devices.map((device) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label}
        </option>
      ))}
    </select>
  );
}
