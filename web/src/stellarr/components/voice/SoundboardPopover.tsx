import type { ReactNode } from "react";

import { Popover, type PopoverTriggerProps } from "@/components/primitives/Popover";

import { SoundboardPanel, type SoundboardPanelProps } from "./SoundboardPanel";

export interface SoundboardPopoverProps extends Omit<SoundboardPanelProps, "lead"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra panel classes, beside `board`. */
  className?: string;
  renderTrigger: (props: PopoverTriggerProps) => ReactNode;
}

/**
 * The soundboard as a panel that hangs off its trigger. Where it hangs is the
 * place's: over the dock in the rail, over its own control in the call's bar.
 * Its body exists only while it is open, so what it shows of a clip under way
 * is measured when it is seen.
 */
export function SoundboardPopover({
  open,
  onOpenChange,
  className,
  renderTrigger,
  onManage,
  ...panel
}: SoundboardPopoverProps) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      className={className ? `board ${className}` : "board"}
      renderTrigger={renderTrigger}
    >
      {open ? (
        <SoundboardPanel
          {...panel}
          onManage={
            onManage &&
            (() => {
              onOpenChange(false);
              onManage();
            })
          }
        />
      ) : null}
    </Popover>
  );
}
