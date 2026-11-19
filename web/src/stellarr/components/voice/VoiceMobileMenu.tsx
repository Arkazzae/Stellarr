import { useState } from "react";

import { Icon, type IconName } from "@stellarr/icons";
import { Popover } from "@/components/primitives/Popover";
import type { Sound, SoundboardLive } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

import { SoundboardPanel } from "./SoundboardPanel";
import { IDLE_SOUNDBOARD } from "./soundboardLive";

interface ActionProps {
  icon: IconName;
  iconSize?: number;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function Action({ icon, iconSize = 18, label, active = false, onClick }: ActionProps) {
  return (
    <button
      type="button"
      className={active ? "vc-mobile-action on" : "vc-mobile-action"}
      aria-pressed={active || undefined}
      onClick={onClick}
    >
      <span className="vc-mobile-action-icon" aria-hidden="true">
        <Icon name={icon} size={iconSize} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export interface VoiceMobileMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sharing: boolean;
  cinema: boolean;
  fullscreen: boolean;
  sounds: Sound[];
  /** False where this person may not play the board: its pads are locked and it says why. */
  soundboardSupported?: boolean;
  soundboardLive?: SoundboardLive;
  /** For people who manage the server: its settings, on the soundboard. */
  onManageSounds?: () => void;
  soundboardVolume: number;
  onSoundboardVolumeChange: (volume: number) => void;
  onToggleShare: () => void;
  onToggleCinema: () => void;
  onToggleFullscreen: () => void;
  onSelectMicrophone: () => void;
  onSelectCamera: () => void;
  /** Absent where the call has no soundboard. */
  onPlaySound?: (soundId: string) => void;
  /** Absent when this member may not invite. */
  onInvite?: () => void;
}

/**
 * The "more" menu that takes over the control bar's secondary buttons on a
 * narrow screen. It opens on a list of actions; the soundboard is a second view
 * inside the same panel, so a sound can be played without leaving the menu.
 */
export function VoiceMobileMenu({
  open,
  onOpenChange,
  sharing,
  cinema,
  fullscreen,
  sounds,
  soundboardSupported = true,
  soundboardLive = IDLE_SOUNDBOARD,
  onManageSounds,
  soundboardVolume,
  onSoundboardVolumeChange,
  onToggleShare,
  onToggleCinema,
  onToggleFullscreen,
  onSelectMicrophone,
  onSelectCamera,
  onPlaySound,
  onInvite,
}: VoiceMobileMenuProps) {
  const { t } = useLanguage();
  const [view, setView] = useState<"actions" | "sounds">("actions");

  const changeOpen = (next: boolean) => {
    if (!next) setView("actions");
    onOpenChange(next);
  };
  const run = (action: () => void) => () => {
    changeOpen(false);
    action();
  };

  return (
    <Popover
      open={open}
      onOpenChange={changeOpen}
      className="vc-mobile-menu"
      renderTrigger={(triggerProps) => (
        <button
          type="button"
          className="vc-btn vc-mobile-more"
          title={t("voiceBar.moreCallOptions")}
          aria-label={t("voiceBar.moreCallOptions")}
          {...triggerProps}
        >
          <Icon name="dots" size={19} />
        </button>
      )}
    >
      {view === "actions" ? (
        <>
          <div className="vc-mobile-menu-head">
            <b>{t("voiceBar.moreCallOptions")}</b>
            <span>{t("voiceBar.lessOften")}</span>
          </div>
          <div className="vc-mobile-actions">
            <Action
              icon="screencast"
              iconSize={20}
              label={sharing ? t("voiceBar.stopSharing") : t("voiceBar.shareScreen")}
              active={sharing}
              onClick={run(onToggleShare)}
            />
            {onPlaySound === undefined ? null : (
              <Action
                icon="board"
                label={t("voice.soundboard")}
                onClick={() => setView("sounds")}
              />
            )}
            {onInvite === undefined ? null : (
              <Action
                icon="userAdd"
                label={t("voiceBar.invitePerson")}
                onClick={run(onInvite)}
              />
            )}
            <Action
              icon={cinema ? "cinemaOff" : "cinema"}
              iconSize={cinema ? 21 : 18}
              label={cinema ? t("voiceBar.cinemaOff") : t("voiceBar.cinema")}
              active={cinema}
              onClick={run(onToggleCinema)}
            />
            <Action
              icon={fullscreen ? "collapse" : "expand"}
              label={fullscreen ? t("voiceBar.leaveFullscreen") : t("voiceBar.fullscreen")}
              active={fullscreen}
              onClick={run(onToggleFullscreen)}
            />
            <Action
              icon="mic"
              label={t("voice.microphone")}
              onClick={run(onSelectMicrophone)}
            />
            <Action
              icon="camera"
              label={t("voice.camera")}
              onClick={run(onSelectCamera)}
            />
          </div>
        </>
      ) : onPlaySound === undefined ? null : (
        // The menu's own head stays, with its way back; the panel brings the
        // countdown and the volume to its end.
        <SoundboardPanel
          sounds={sounds}
          live={soundboardLive}
          canPlay={soundboardSupported}
          onPlaySound={onPlaySound}
          onManage={onManageSounds && run(onManageSounds)}
          volume={soundboardVolume}
          onVolumeChange={onSoundboardVolumeChange}
          lead={
            <span className="vc-mobile-menu-head sounds">
              <button
                type="button"
                className="vc-mobile-back"
                aria-label={t("voiceBar.backToCallOptions")}
                onClick={() => setView("actions")}
              >
                <Icon name="caret" size={14} />
              </button>
              <b>{t("voice.soundboard")}</b>
            </span>
          }
        />
      )}
    </Popover>
  );
}
