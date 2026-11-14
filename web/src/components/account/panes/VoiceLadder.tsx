"use client";

import { Segmented, type SegmentedOption } from "@/components/primitives/Segmented";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/hooks";

/** One rung of a ladder: a short name, and the sentence kept for the line under the row. */
export interface Rung {
  label: MessageKey;
  hint: MessageKey;
}

export interface LadderProps<T extends string> {
  /** Left to right: less of something to more of it. */
  order: readonly T[];
  rungs: Record<T, Rung>;
  value: T;
  onChange: (value: T) => void;
  /** Names the group for assistive technology. */
  label: string;
}

/**
 * A row of exclusive choices that climb a scale, as one compact pill, with the
 * chosen rung explained underneath.
 *
 * The explanation also stays on each tile as its tooltip, so a pointer can
 * compare rungs without changing anything; touch has no hover, which is why the
 * chosen one is spelled out below as well.
 */
export function Ladder<T extends string>({
  order,
  rungs,
  value,
  onChange,
  label,
}: LadderProps<T>) {
  const { t } = useLanguage();
  const options = order.map(
    (id): SegmentedOption<T> => ({
      value: id,
      label: t(rungs[id].label),
      title: t(rungs[id].hint),
    }),
  );

  return (
    <>
      <Segmented
        options={options}
        value={value}
        onChange={onChange}
        label={label}
        variant="pill"
        className="ladder"
      />
      <p className="ladder-note">{t(rungs[value].hint)}</p>
    </>
  );
}
