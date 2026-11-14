"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { Switch } from "@/components/primitives/Switch";
import {
  canSaveSound,
  DEFAULT_SOUND_GLYPH,
  SoundEditor,
  type SoundDraft,
  type SoundEdit,
} from "@/components/settings/SoundEditor";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { decodeWaveform, MAX_CLIP_SECONDS } from "@/components/settings/WaveformTrimmer";
import { useSoundPreview, type SoundPreviewPlayback } from "@/components/settings/soundPreview";
import type { NewSound, Sound, SoundPatch } from "@/ports";
import { useLanguage } from "@/state/hooks";

export type { SoundPreviewPlayback };

const MAX_SOUNDS = 48;
const MAX_NAME_LENGTH = 32;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export interface SoundboardPaneProps {
  supported: boolean;
  sounds: readonly Sound[];
  everyoneCanPlay: boolean;
  onEveryoneCanPlayChange: (value: boolean) => void;
  rateLimited: boolean;
  onRateLimitedChange: (value: boolean) => void;
  loading?: boolean;
  error?: string | null;
  onCreate: (input: NewSound) => Promise<unknown>;
  onUpdate: (soundId: string, patch: SoundPatch) => Promise<unknown>;
  onDelete: (soundId: string) => Promise<void>;
  playback: SoundPreviewPlayback;
  /** The same dial the call carries; the preview does not own a second one. */
  onSoundboardVolumeChange: (volume: number) => void;
}

export function SoundboardPane({
  supported,
  sounds,
  everyoneCanPlay,
  onEveryoneCanPlayChange,
  rateLimited,
  onRateLimitedChange,
  loading = false,
  error = null,
  onCreate,
  onUpdate,
  onDelete,
  playback,
  onSoundboardVolumeChange,
}: SoundboardPaneProps) {
  const { locale, t } = useLanguage();
  const confirm = useConfirm();
  const decimal = new Intl.NumberFormat(locale === "en" ? "en-GB" : "pl-PL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const picker = useRef<HTMLInputElement>(null);
  const preview = useSoundPreview(playback);
  // Counts every load and close, so that a decode which finishes after the
  // editor moved on, or the pane left, is discarded.
  const loads = useRef(0);
  const [draft, setDraft] = useState<SoundDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // A chosen file is previewed from a blob URL that lives as long as its draft.
  const blobUrl = draft?.file != null ? draft.previewUrl : undefined;
  useEffect(
    () => () => {
      if (blobUrl !== undefined) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl],
  );
  useEffect(
    () => () => {
      loads.current += 1;
    },
    [],
  );

  const closeEditor = () => {
    loads.current += 1;
    preview.stop();
    setDraft(null);
    setLocalError(null);
  };

  const chooseFile = async (file: File) => {
    const load = ++loads.current;
    setBusy(true);
    setLocalError(null);
    try {
      const waveform = await decodeWaveform(file);
      if (load !== loads.current) return;
      setDraft({
        ...waveform,
        revision: load,
        id: null,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name.replace(/\.[^.]+$/, "").slice(0, MAX_NAME_LENGTH),
        glyph: DEFAULT_SOUND_GLYPH,
        start: 0,
        end: Math.min(waveform.duration, MAX_CLIP_SECONDS),
      });
    } catch {
      if (load === loads.current) setLocalError(t("settings.soundReadFailed"));
    } finally {
      if (load === loads.current) setBusy(false);
    }
  };

  const edit = async (sound: Sound) => {
    const load = ++loads.current;
    preview.stop();
    setBusy(true);
    setLocalError(null);
    try {
      const response = await fetch(sound.url, { credentials: "same-origin" });
      if (!response.ok) throw new Error("asset unavailable");
      const waveform = await decodeWaveform(await response.arrayBuffer());
      if (load !== loads.current) return;
      const start = Math.min(
        waveform.duration,
        Math.max(0, finiteOr(sound.trimStartSeconds, 0)),
      );
      const end = Math.min(
        waveform.duration,
        Math.max(start, finiteOr(sound.trimEndSeconds, waveform.duration)),
      );
      setDraft({
        ...waveform,
        revision: load,
        id: sound.id,
        file: null,
        previewUrl: sound.url,
        name: sound.name,
        glyph: sound.glyph,
        start,
        end,
      });
    } catch {
      if (load === loads.current) setLocalError(t("settings.soundWaveformFailed"));
    } finally {
      if (load === loads.current) setBusy(false);
    }
  };

  const save = async () => {
    if (draft === null || !canSaveSound(draft)) return;
    setBusy(true);
    setLocalError(null);
    try {
      if (draft.file !== null) {
        await onCreate({
          file: draft.file,
          name: draft.name,
          glyph: draft.glyph,
          durationSeconds: draft.duration,
          trimStartSeconds: draft.start,
          trimEndSeconds: draft.end,
        });
      } else if (draft.id !== null) {
        await onUpdate(draft.id, {
          name: draft.name,
          glyph: draft.glyph,
          trimStartSeconds: draft.start,
          trimEndSeconds: draft.end,
        });
      }
      closeEditor();
    } catch {
      setLocalError(t("settings.soundSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (sound: Sound) => {
    const confirmed = await confirm({
      title: t("settings.deleteSoundTitle", { name: sound.name }),
      description: t("settings.deleteSoundDescription"),
      confirmLabel: t("common.remove"),
      danger: true,
      icon: "trash",
    });
    if (!confirmed) return;
    setBusy(true);
    setLocalError(null);
    try {
      await onDelete(sound.id);
      if (draft?.id === sound.id) closeEditor();
    } catch {
      setLocalError(t("settings.soundDeleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again still fires a change.
    event.target.value = "";
    if (file !== undefined) void chooseFile(file);
  };

  const applyEdit = (changes: SoundEdit) =>
    setDraft((current) => (current === null ? current : { ...current, ...changes }));

  const atLimit = sounds.length >= MAX_SOUNDS;
  const shownError = localError ?? error;

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.soundboardUnsupported")}</p>}
      {shownError ? (
        <p className="set-note sound-error" role="alert">
          {shownError}
        </p>
      ) : null}

      <SettingsSection
        title={t("settings.soundboard")}
        count={`${sounds.length}/${MAX_SOUNDS}`}
        countLabel={t("settings.soundCount", { count: sounds.length, max: MAX_SOUNDS })}
        countTitle={t("settings.soundCountTitle")}
        className="sound-library"
        action={
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="asset-add"
              disabled={!supported || busy || loading || atLimit}
              title={atLimit ? t("settings.soundLimitTitle") : undefined}
              onClick={() => picker.current?.click()}
            >
              <Icon name="plus" size={15} />
              {t("settings.addSound")}
            </Button>
            <input
              ref={picker}
              type="file"
              accept="audio/*,.mp3,.ogg,.wav,.webm,.m4a,.aac"
              hidden
              onChange={onFileChosen}
            />
          </>
        }
      >
        {loading ? <p className="int-empty">{t("common.loading")}</p> : null}
        {sounds.length === 0 && !loading ? (
          <div className="asset-empty">
            <Icon name="wave" size={24} />
            <b>{t("settings.noSounds")}</b>
            <span>{t("settings.noSoundsDetail")}</span>
          </div>
        ) : (
          <div className="sound-list" aria-busy={loading || busy}>
            {sounds.map((sound) => {
              const clip = Math.max(0, finiteOr(sound.trimEndSeconds - sound.trimStartSeconds, 0));
              return (
                <div
                  className={draft?.id === sound.id ? "sound-row active" : "sound-row"}
                  key={sound.id}
                >
                  <span className="sound-mark" aria-hidden="true">
                    {sound.glyph}
                  </span>
                  <span className="sound-row-txt">
                    <b>{sound.name}</b>
                    <span>
                      {decimal.format(clip)} s ·{" "}
                      {t("settings.soundSource", { seconds: decimal.format(sound.durationSeconds) })}
                    </span>
                  </span>
                  {supported ? (
                    <span className="sound-row-actions">
                      <button
                        type="button"
                        className="set-item-act"
                        disabled={busy}
                        aria-label={t("settings.editSound", { name: sound.name })}
                        onClick={() => void edit(sound)}
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        type="button"
                        className="set-item-act danger"
                        disabled={busy}
                        aria-label={t("settings.deleteSound", { name: sound.name })}
                        onClick={() => void remove(sound)}
                      >
                        {t("common.remove")}
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>

      {draft === null ? null : (
        <SoundEditor
          key={draft.revision}
          draft={draft}
          busy={busy}
          soundboardVolume={playback.soundboardVolume}
          onSoundboardVolumeChange={onSoundboardVolumeChange}
          onEdit={applyEdit}
          onPreview={() =>
            preview.play(
              { url: draft.previewUrl, start: draft.start, end: draft.end },
              () => setLocalError(t("settings.soundPreviewBlocked")),
            )
          }
          onSave={() => void save()}
          onClose={closeEditor}
        />
      )}

      <section className="sound-group" aria-labelledby="sound-rules-title">
        <header className="int-cap sound-cap">
          <b id="sound-rules-title">{t("settings.soundRules")}</b>
          <span>{t("settings.soundRulesDetail")}</span>
        </header>
        <div className="sound-rules">
          <div className="sound-rule-row">
            <span className="set-lab">
              <b>{t("settings.everyoneCanPlay")}</b>
              <span>{t("settings.everyoneCanPlayDetail")}</span>
            </span>
            <Switch
              checked={everyoneCanPlay}
              onChange={onEveryoneCanPlayChange}
              label={t("settings.everyoneCanPlay")}
              disabled={!supported}
            />
          </div>
          <div className="sound-rule-row">
            <span className="set-lab">
              <b>{t("settings.soundRateLimit")}</b>
              <span>{t("settings.soundRateLimitDetail")}</span>
            </span>
            <Switch
              checked={rateLimited}
              onChange={onRateLimitedChange}
              label={t("settings.soundRateLimit")}
              disabled={!supported}
            />
          </div>
        </div>
      </section>
    </>
  );
}
