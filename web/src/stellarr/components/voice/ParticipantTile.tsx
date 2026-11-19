import { useEffect, useRef, useSyncExternalStore } from "react";

import { Icon } from "@stellarr/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { useContextMenu } from "@/components/primitives/ContextMenu";
import { UserMenu } from "@/components/roster/UserMenu";
import type { OpenProfile, PersonVM } from "@/components/view-models";
import type { SoundboardLive, SoundboardPlay } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

export interface ParticipantTileProps {
  person: PersonVM;
  /** The name on the tile, where it is not the person's own, such as "You". */
  label?: string;
  /** Where the tile sits in a layout of its own rather than the grid. */
  className?: string;
  /** Without a stream the tile shows the person's avatar. */
  stream?: MediaStream | null;
  /** The camera is on, but held back for the viewer's link: the avatar says so. */
  held?: boolean;
  /** Your own camera: played back muted so the room does not hear itself. */
  local?: boolean;
  /** Receiver-side mixer level. Without it the tile has no mixer strip. */
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  /** Receiver-side gate on the same strip. Absent hides the control. */
  gated?: boolean;
  onGateChange?: (gated: boolean) => void;
  /** Receiver-side suppressor on the same strip. Absent hides the control. */
  suppressed?: boolean;
  onSuppressionChange?: (suppressed: boolean) => void;
  /** The board's clips under way: one this person played shows after their name. */
  soundPlays?: SoundboardLive;
  onOpenProfile?: OpenProfile;
}

/** The latest clip this person played that is still under way, the same object while it plays. */
function latestPlayOf(plays: readonly SoundboardPlay[], personId: string): SoundboardPlay | undefined {
  for (let index = plays.length - 1; index >= 0; index -= 1) {
    if (plays[index]?.userId === personId) return plays[index];
  }
  return undefined;
}

/**
 * The emoji of the clip a person is playing, beside their name for as long as
 * it plays. It reads the board's live store itself, so a clip starting
 * re-renders this and nothing else of the tile.
 */
function TileSound({ live, person }: { live: SoundboardLive; person: PersonVM }) {
  const { t } = useLanguage();
  const play = useSyncExternalStore(
    live.subscribe,
    () => latestPlayOf(live.playing(), person.id),
    () => undefined,
  );
  if (play === undefined) return null;
  const label = t("voice.soundPlaying", { name: person.displayName, sound: play.sound.name });
  return (
    <span className="t-sound" role="img" aria-label={label} title={label}>
      {play.sound.glyph}
    </span>
  );
}

/** One person on the voice stage. */
export function ParticipantTile({
  person,
  label,
  className,
  stream: given,
  held = false,
  local = false,
  volume,
  onVolumeChange,
  gated,
  onGateChange,
  suppressed,
  onSuppressionChange,
  soundPlays,
  onOpenProfile,
}: ParticipantTileProps) {
  const video = useRef<HTMLVideoElement>(null);
  const menu = useContextMenu();
  const { t } = useLanguage();
  // A picture that does not decrypt is no picture: nothing of it is played.
  const stream = person.undecryptable?.video ? null : given;

  // `srcObject` is a property, never an attribute. Clearing it on the way out
  // drops the element's hold on the tracks, so a stopped camera does not leave
  // a frozen frame behind.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream ?? null;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  // In an encrypted call: what of theirs reaches this side and does not decrypt.
  const undecryptable = person.undecryptable;
  const sealed =
    undecryptable === undefined || (!undecryptable.audio && !undecryptable.video)
      ? null
      : undecryptable.audio && undecryptable.video
        ? "voice.undecryptableBoth"
        : undecryptable.audio
          ? "voice.undecryptableAudio"
          : "voice.undecryptableVideo";

  // Your own tile has nobody to turn down, so it never offers the strip.
  const mixer =
    !local && volume !== undefined && onVolumeChange !== undefined
      ? { volume, onVolumeChange }
      : null;
  const hasMenu = mixer !== null || onOpenProfile !== undefined;

  const classes = [
    "tile",
    className,
    stream && "has-video",
    hasMenu && "has-actions",
    person.speaking && "speaking",
    person.muted && "muted",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} onContextMenu={hasMenu ? menu.onContextMenu : undefined}>
      {hasMenu && menu.at !== null ? (
        <UserMenu
          at={menu.at}
          userId={person.id}
          displayName={person.displayName}
          self={local}
          anchor={menu.anchor}
          onOpenProfile={onOpenProfile}
          participantVolumeOf={mixer ? () => mixer.volume : undefined}
          onParticipantVolumeChange={
            mixer ? (_userId, next) => mixer.onVolumeChange(next) : undefined
          }
          participantGateOf={mixer && onGateChange ? () => gated ?? false : undefined}
          onParticipantGateChange={
            mixer && onGateChange ? (_userId, next) => onGateChange(next) : undefined
          }
          participantSuppressionOf={
            mixer && onSuppressionChange ? () => suppressed ?? false : undefined
          }
          onParticipantSuppressionChange={
            mixer && onSuppressionChange
              ? (_userId, next) => onSuppressionChange(next)
              : undefined
          }
          onClose={menu.close}
        />
      ) : null}
      {stream ? (
        <video
          ref={video}
          autoPlay
          playsInline
          muted={local}
          aria-label={t("voice.cameraOf", { name: person.displayName })}
        />
      ) : (
        <Avatar
          id={person.id}
          displayName={person.displayName}
          initials={person.initials}
          avatarUrl={person.avatarUrl}
          size="xl"
        />
      )}
      <span className="t-name">
        <span>{label ?? person.displayName}</span>
        {soundPlays === undefined ? null : <TileSound live={soundPlays} person={person} />}
      </span>
      <span className="t-mic" aria-hidden="true">
        <Icon name="micSlash" size={14} />
      </span>
      {sealed !== null ? (
        <span className="t-held t-sealed" role="status">
          {t(sealed, { name: person.displayName })}
        </span>
      ) : held && !stream ? (
        <span className="t-held" role="status">
          {t("voice.pictureHeldBack")}
        </span>
      ) : null}
      {hasMenu ? (
        <button
          type="button"
          className="tile-more"
          aria-label={t("common.moreActions", { name: person.displayName })}
          // With no profile to open the menu is only the mixer strip, which
          // the menu presents as a dialog.
          aria-haspopup={onOpenProfile === undefined ? "dialog" : "menu"}
          aria-expanded={menu.at !== null}
          onClick={(event) => {
            const trigger = event.currentTarget;
            const bounds = trigger.getBoundingClientRect();
            menu.openAt(trigger, bounds.right, bounds.bottom + 4);
          }}
        >
          <Icon name="dots" size={16} />
        </button>
      ) : null}
    </div>
  );
}
