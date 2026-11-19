import { useState, useSyncExternalStore } from "react";

import { Icon } from "@stellarr/icons";
import type { PopoverTriggerProps } from "@/components/primitives/Popover";
import type { Sound, SoundboardLive, VoiceSettings } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

import { QualityMenu } from "./QualityMenu";
import {
  cameraQualityMenu,
  micQualityMenu,
  screenQualityMenu,
} from "./qualityMenus";
import { SoundboardPopover } from "./SoundboardPopover";
import { IDLE_SOUNDBOARD } from "./soundboardLive";
import { VoiceMobileMenu } from "./VoiceMobileMenu";

type Drawer = "mic" | "camera" | "screen";

function subscribeToFullscreen(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

// Truthiness rather than `!== null`: engines without the API leave the property
// undefined, which has to read as "not full screen".
const isFullscreen = () => Boolean(document.fullscreenElement);

/** The small arrow beside a button; it opens that button's quality drawer. */
function CaretButton({ label, ...trigger }: PopoverTriggerProps & { label: string }) {
  return (
    <button type="button" className="vc-caret" title={label} aria-label={label} {...trigger}>
      <Icon name="caret" size={12} />
    </button>
  );
}

export interface VoiceControlBarProps {
  muted: boolean;
  /** Everything you would hear is silenced: the call and the soundboard. */
  deafened: boolean;
  cameraOn: boolean;
  cameraPending?: boolean;
  sharing: boolean;
  /** Drives the cinema toggle's icon, title and pressed state. */
  cinema: boolean;

  /** What the soundboard offers; see `onPlaySound`. */
  sounds?: Sound[];
  /** False where this person may not play the board: its pads are locked and it says why. */
  soundboardSupported?: boolean;
  /** What plays in the room and the cooldown, read by the soundboard panel alone. */
  soundboardLive?: SoundboardLive;
  /** For people who manage the server: its settings, on the soundboard. */
  onManageSounds?: () => void;

  /** Device settings, applied to the call already in progress. */
  settings: VoiceSettings;
  onChangeSettings: (patch: Partial<VoiceSettings>) => void;
  /** False disables the camera when the browser has no media-device support. */
  cameraSupported?: boolean;

  /**
   * The element to put into full screen. A getter, so the caller hands over
   * whatever it has at the moment of the click; returning null does nothing.
   */
  fullscreenTarget?: () => HTMLElement | null;

  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onSelectMicrophone: () => void;
  onSelectCamera: () => void;
  onToggleShare: () => void;
  /** Absent where the call has no soundboard, which is a private one. */
  onPlaySound?: (soundId: string) => void;
  /** Absent when this member may not create or send server invitations. */
  onInvite?: () => void;
  onToggleCinema: () => void;
  onLeave: () => void;
  /** Absent where the call has no window of its own to move to. */
  onPopOut?: () => void;
}

/**
 * The controls under the stage: what you say and hear in one pill, what you
 * show in the next, then hanging up, and the controls of the view itself
 * together on the right. Every control that opens a panel is wrapped with it,
 * so the panel is centred on the control that opened it.
 *
 * Two pieces of state live here because props cannot describe them: full
 * screen, which the browser can leave on its own (Esc), and which panel is
 * open. Everything else comes from above.
 */
export function VoiceControlBar({
  muted,
  deafened,
  cameraOn,
  cameraPending = false,
  sharing,
  cinema,
  sounds = [],
  soundboardSupported = true,
  soundboardLive = IDLE_SOUNDBOARD,
  onManageSounds,
  settings,
  onChangeSettings,
  cameraSupported = false,
  fullscreenTarget,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onSelectMicrophone,
  onSelectCamera,
  onToggleShare,
  onPlaySound,
  onInvite,
  onToggleCinema,
  onLeave,
  onPopOut,
}: VoiceControlBarProps) {
  const { t } = useLanguage();
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [compactMenuOpen, setCompactMenuOpen] = useState(false);

  // The button follows the browser's event rather than its own last click, so
  // `aria-pressed` cannot disagree after Esc or the system UI leaves full screen.
  const fullscreen = useSyncExternalStore(subscribeToFullscreen, isFullscreen, () => false);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    void fullscreenTarget?.()?.requestFullscreen?.();
  };

  const drawerState = (id: Drawer) => ({
    open: drawer === id,
    onOpenChange: (open: boolean) => setDrawer(open ? id : null),
  });

  const changeCompactMenu = (open: boolean) => {
    setCompactMenuOpen(open);
    if (open) {
      setDrawer(null);
      setBoardOpen(false);
    }
  };

  const changeSoundboardVolume = (soundboardVolume: number) =>
    onChangeSettings({ soundboardVolume });

  const mic = micQualityMenu(settings, t, onChangeSettings);
  const camera = cameraQualityMenu(settings, cameraSupported, t, onChangeSettings);
  const screen = screenQualityMenu(settings, t, onChangeSettings);

  const cinemaTitle = cinema ? t("voiceBar.cinemaExit") : t("voiceBar.cinema");
  const fullscreenTitle = fullscreen ? t("voiceBar.fullscreenExit") : t("voiceBar.fullscreen");
  const micTitle = muted ? t("voiceBar.unmute") : t("voiceBar.mute");
  const soundTitle = deafened ? t("shell.unmuteSound") : t("shell.muteSound");
  const cameraTitle = cameraPending
    ? t("voiceBar.cameraStarting")
    : cameraOn
      ? t("voiceBar.cameraStop")
      : t("voiceBar.cameraStart");

  return (
    <div className="vc-bar">
      <div className="vc-center">
        <div className="vc-grp">
          <div className="vc-ctl">
            <button
              type="button"
              className={muted ? "vc-btn muted" : "vc-btn"}
              aria-pressed={muted}
              title={micTitle}
              aria-label={t("voice.microphone")}
              onClick={onToggleMute}
            >
              <Icon name={muted ? "micSlash" : "mic"} size={19} />
            </button>
            <QualityMenu
              {...drawerState("mic")}
              title={t("voiceBar.micDrawerTitle")}
              summary={mic.summary}
              groups={mic.groups}
              footer={{ label: t("voiceBar.moreSoundSettings"), onSelect: onSelectMicrophone }}
              renderTrigger={(trigger) => (
                <CaretButton label={t("voiceBar.micQualityMenu")} {...trigger} />
              )}
            />
          </div>
          <button
            type="button"
            className={deafened ? "vc-btn muted" : "vc-btn"}
            aria-pressed={deafened}
            title={soundTitle}
            aria-label={t("shell.muteSound")}
            onClick={onToggleDeafen}
          >
            <Icon name={deafened ? "headphonesSlash" : "headphones"} size={19} />
          </button>
        </div>

        <div className="vc-grp">
          <div className="vc-ctl">
            <button
              type="button"
              className={cameraOn ? "vc-btn on" : "vc-btn"}
              aria-pressed={cameraOn}
              title={cameraTitle}
              aria-label={cameraTitle}
              aria-busy={cameraPending || undefined}
              disabled={!cameraSupported || cameraPending}
              onClick={onToggleCamera}
            >
              <Icon name="camera" size={19} />
            </button>
            <QualityMenu
              {...drawerState("camera")}
              title={t("voiceBar.cameraDrawerTitle")}
              summary={camera.summary}
              groups={camera.groups}
              note={cameraSupported ? undefined : t("voiceBar.cameraUnsupported")}
              footer={{ label: t("voiceBar.moreVideoSettings"), onSelect: onSelectCamera }}
              renderTrigger={(trigger) => (
                <CaretButton label={t("voiceBar.cameraQualityMenu")} {...trigger} />
              )}
            />
          </div>
          {/* A narrow bar keeps only the camera in this pill; "more" has the rest. */}
          <div className="vc-ctl vc-wide-only">
            <button
              type="button"
              className={sharing ? "vc-btn on" : "vc-btn"}
              aria-pressed={sharing}
              title={t("voiceBar.shareScreen")}
              aria-label={t("voiceBar.shareScreen")}
              onClick={onToggleShare}
            >
              <Icon name="screencast" size={22} />
            </button>
            <QualityMenu
              {...drawerState("screen")}
              title={t("voiceBar.screenQuality")}
              summary={screen.summary}
              groups={screen.groups}
              renderTrigger={(trigger) => (
                <CaretButton label={t("voiceBar.screenQuality")} {...trigger} />
              )}
            />
          </div>
          {onPlaySound === undefined ? null : (
            <div className="vc-ctl vc-wide-only">
              <SoundboardPopover
                sounds={sounds}
                live={soundboardLive}
                canPlay={soundboardSupported}
                open={boardOpen}
                onOpenChange={setBoardOpen}
                onPlaySound={onPlaySound}
                onManage={onManageSounds}
                volume={settings.soundboardVolume}
                onVolumeChange={changeSoundboardVolume}
                renderTrigger={(triggerProps) => (
                  <button
                    type="button"
                    className="vc-btn"
                    title={t("voice.soundboard")}
                    aria-label={t("voice.soundboard")}
                    {...triggerProps}
                  >
                    <Icon name="board" size={19} />
                  </button>
                )}
              />
            </div>
          )}
        </div>

        <div className="vc-mobile-overflow">
          <VoiceMobileMenu
            open={compactMenuOpen}
            onOpenChange={changeCompactMenu}
            sharing={sharing}
            cinema={cinema}
            fullscreen={fullscreen}
            sounds={sounds}
            soundboardSupported={soundboardSupported}
            soundboardLive={soundboardLive}
            onManageSounds={onManageSounds}
            soundboardVolume={settings.soundboardVolume}
            onSoundboardVolumeChange={changeSoundboardVolume}
            onToggleShare={onToggleShare}
            onToggleCinema={onToggleCinema}
            onToggleFullscreen={toggleFullscreen}
            onSelectMicrophone={onSelectMicrophone}
            onSelectCamera={onSelectCamera}
            onPlaySound={onPlaySound}
            onInvite={onInvite}
          />
        </div>

        <button
          type="button"
          className="vc-hang"
          title={t("voiceBar.disconnect")}
          aria-label={t("voiceBar.disconnect")}
          onClick={onLeave}
        >
          <Icon name="phoneX" size={20} />
        </button>
      </div>

      <div className="vc-side">
        {onInvite === undefined ? null : (
          <button
            type="button"
            className="vc-plain"
            title={t("voiceBar.inviteChannel")}
            aria-label={t("voiceBar.inviteChannel")}
            onClick={onInvite}
          >
            <Icon name="userAdd" size={19} />
          </button>
        )}
        <button
          type="button"
          className="vc-plain"
          aria-pressed={cinema}
          title={cinemaTitle}
          aria-label={cinemaTitle}
          onClick={onToggleCinema}
        >
          <Icon name={cinema ? "cinemaOff" : "cinema"} size={cinema ? 21 : 18} />
        </button>
        <button
          type="button"
          className="vc-plain"
          aria-pressed={fullscreen}
          title={fullscreenTitle}
          aria-label={fullscreenTitle}
          onClick={toggleFullscreen}
        >
          <Icon name={fullscreen ? "collapse" : "expand"} size={18} />
        </button>
        {onPopOut === undefined ? null : (
          <button
            type="button"
            className="vc-plain"
            title={t("voiceBar.popOut")}
            aria-label={t("voiceBar.popOut")}
            onClick={onPopOut}
          >
            <Icon name="popout" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
