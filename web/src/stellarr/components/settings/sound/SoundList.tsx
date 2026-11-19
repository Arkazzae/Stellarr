import { useId, useState } from "react";

import { Icon } from "@stellarr/icons";
import { DragAnnouncer } from "@/lib/drag/DragAnnouncer";
import { createAnnouncer } from "@/lib/drag/announcer";
import type { Sound } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { useRowReorder } from "./useRowReorder";

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Called once, when the element it is on appears. */
const focusOnArrival = (node: HTMLElement | null) => node?.focus();

export interface SoundListProps {
  sounds: readonly Sound[];
  /** Whoever may manage the board can move, edit and delete; anyone can listen. */
  editable: boolean;
  /** A sound is being loaded, saved or deleted: editing and deleting wait. */
  busy: boolean;
  /** The board is being fetched again. */
  loading?: boolean;
  /** The sound being auditioned, if any. */
  previewing: string | null;
  /** Seconds as the pane writes them, such as "1,2 s". */
  formatSeconds: (seconds: number) => string;
  /** Focus goes to this sound's edit button when the list appears, as after its editor closed. */
  focusEdit?: string | null;
  /** Starts the sound's trimmed clip, or stops it while it plays. */
  onPreview: (sound: Sound) => void;
  onEdit: (sound: Sound) => void;
  onDelete: (sound: Sound) => void;
  /** The whole new order, already shown. */
  onReorder: (soundIds: string[]) => void;
}

/** The server's sounds, one row each, in the order the call shows them. */
export function SoundList({
  sounds,
  editable,
  busy,
  loading = false,
  previewing,
  formatSeconds,
  focusEdit = null,
  onPreview,
  onEdit,
  onDelete,
  onReorder,
}: SoundListProps) {
  const { t } = useLanguage();
  const hintId = useId();
  const [announcer] = useState(createAnnouncer);
  const { list, row, handle } = useRowReorder({
    ids: sounds.map((sound) => sound.id),
    onMove: (order, id) => {
      onReorder(order);
      const sound = sounds.find((item) => item.id === id);
      if (sound === undefined) return;
      announcer.say(
        t("settings.soundMoved", {
          name: sound.name,
          position: order.indexOf(id) + 1,
          count: order.length,
        }),
      );
    },
  });

  return (
    <>
      <ol
        className={editable ? "sound-list" : "sound-list readonly"}
        ref={list}
        aria-busy={busy || loading}
      >
        {sounds.map((sound) => {
          const clip = Math.max(0, finiteOr(sound.trimEndSeconds - sound.trimStartSeconds, 0));
          const playing = previewing === sound.id;
          return (
            <li
              key={sound.id}
              className="sound-row"
              data-playing={playing ? "" : undefined}
              ref={row(sound.id)}
            >
              {editable ? (
                <button
                  type="button"
                  className="sound-grip"
                  aria-label={t("settings.moveSound", { name: sound.name })}
                  aria-describedby={hintId}
                  {...handle(sound.id)}
                >
                  <Icon name="grip" size={16} />
                </button>
              ) : null}
              <button
                type="button"
                className="sound-act sound-play"
                aria-label={t(playing ? "settings.stopSound" : "settings.playSound", {
                  name: sound.name,
                })}
                onClick={() => onPreview(sound)}
              >
                <Icon name={playing ? "stop" : "play"} size={16} />
              </button>
              <span className="sound-glyph" aria-hidden="true">
                {sound.glyph}
              </span>
              <span className="sound-name">{sound.name}</span>
              <span className="sound-length">{formatSeconds(clip)}</span>
              {editable ? (
                <span className="sound-tools">
                  <button
                    type="button"
                    className="sound-act"
                    disabled={busy}
                    aria-label={t("settings.editSound", { name: sound.name })}
                    ref={sound.id === focusEdit ? focusOnArrival : undefined}
                    onClick={() => onEdit(sound)}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    className="sound-act danger"
                    disabled={busy}
                    aria-label={t("settings.deleteSound", { name: sound.name })}
                    onClick={() => onDelete(sound)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {editable ? (
        <DragAnnouncer
          instructions={[{ id: hintId, text: t("settings.moveSoundHint") }]}
          announcer={announcer}
        />
      ) : null}
    </>
  );
}
