"use client";

import { useMemo } from "react";

import { encodeQr } from "@/lib/qr";

import steps from "./SignInSteps.module.css";

/** The four light modules a scanner expects around the code. */
const QUIET = 4;

export interface QrCodeProps {
  value: string;
  label: string;
}

/** A QR code drawn on this device; the value never leaves it. */
export function QrCode({ value, label }: QrCodeProps) {
  const { size, path } = useMemo(() => {
    const qr = encodeQr(value);
    let d = "";
    qr.dark.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }),
    );
    return { size: qr.size + QUIET * 2, path: d };
  }, [value]);

  return (
    <div className={steps.qr}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
        <path d={path} fill="currentColor" />
      </svg>
    </div>
  );
}
