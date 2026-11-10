"use client";

import { useState } from "react";

import type { ScreenShareVM } from "@/components/view-models";

import { ParticipantTiles, type ParticipantTilesProps } from "./ParticipantTiles";
import { ShareBand } from "./ShareBand";
import { StageFocusBar, type StageFocus } from "./StageFocusBar";

export interface VoiceStageProps extends ParticipantTilesProps {
  /** Null when nobody is sharing; the band is then absent, not empty. */
  share: ScreenShareVM | null;
  /** True when the share is your own screen, which must play back muted. */
  localShare?: boolean;
  onWatchShare: () => void;
  onStopWatchingShare: () => void;
  /**
   * Cinema mode. The stage only hides the tiles; the matching `.stage-full` on
   * the shell (which also collapses the roster) is the shell's business, so the
   * flag is passed in rather than owned here.
   */
  cinema?: boolean;
}

/**
 * The call's two surfaces, a screen share and the tiles, and a local choice of
 * which one has the stage. A share takes it unless the viewer picked the tiles.
 */
export function VoiceStage({
  share,
  localShare = false,
  onWatchShare,
  onStopWatchingShare,
  cinema = false,
  participantVolumes,
  onParticipantVolumeChange,
  ...tiles
}: VoiceStageProps) {
  const [chosen, setChosen] = useState<StageFocus | null>(null);
  const showingShare = share !== null && chosen !== "tiles";

  const classes = [
    "voice-stage",
    showingShare && "streaming",
    share !== null && "has-focus-bar",
    // Cinema is only a mode when there is something to be immersed in.
    cinema && showingShare && "cinema",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {share === null ? null : (
        <StageFocusBar
          focus={showingShare ? "share" : "tiles"}
          onFocus={setChosen}
          share={share}
        />
      )}

      {showingShare ? (
        <ShareBand
          share={share}
          local={localShare}
          volume={participantVolumes?.get(share.ownerId)}
          onVolumeChange={
            onParticipantVolumeChange &&
            ((volume) => onParticipantVolumeChange(share.ownerId, volume))
          }
          onWatch={onWatchShare}
          onStopWatching={onStopWatchingShare}
        />
      ) : null}

      <ParticipantTiles
        {...tiles}
        participantVolumes={participantVolumes}
        onParticipantVolumeChange={onParticipantVolumeChange}
      />
    </div>
  );
}
