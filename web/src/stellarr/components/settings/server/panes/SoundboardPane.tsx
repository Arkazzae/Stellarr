import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/icons";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { Switch } from "@/components/primitives/Switch";
import {
  canSaveSound,
  DEFAULT_SOUND_GLYPH,
  MAX_SOUND_NAME_LENGTH,
  SoundEditor,
  type SoundDraft,
  type SoundEdit,
} from "@/components/settings/sound/SoundEditor";
import { SoundList } from "@/components/settings/sound/SoundList";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { decodeWaveform, MAX_CLIP_SECONDS } from "@/components/settings/sound/WaveformTrimmer";
import { useSoundPreview, type SoundPreviewPlayback } from "@/components/settings/sound/soundPreview";
import type { NewSound, Sound, SoundPatch } from "@/ports";
import { useLanguage } from "@/state/hooks";

export type { SoundPreviewPlayback };

const MAX_SOUNDS = 48;

/** The key the editor's own clip is auditioned under; sounds use their ids. */
const DRAFT_PREVIEW = "draft";

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export interface SoundboardPaneProps {
  /** Whether this person may manage the board; without it the list is read only. */
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
  /** Shows the new order at once and saves it; rejects, with the old order back, when refused. */
  onReorder: (soundIds: string[]) => Promise<void>;
  playback: SoundPreviewPlayback;
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
  onReorder,
  playback,
}: SoundboardPaneProps) {
  const { locale, t } = useLanguage();
  const confirm = useConfirm();
  const decimal = new Intl.NumberFormat(locale === "en" ? "en-GB" : "pl-PL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const seconds = (value: number) =>
    t("settings.soundSeconds", { seconds: decimal.format(finiteOr(value, 0)) });
  const picker = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const preview = useSoundPreview(playback);
  // Counts every load and close, so that a decode which finishes after the
  // editor moved on, or the pane left, is discarded.
  const loads = useRef(0);
  const [draft, setDraft] = useState<SoundDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  /** Where focus goes back to once an editor closes: a sound's edit button, or "add". */
  const [returnTo, setReturnTo] = useState<string | null>(null);

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
  useEffect(() => {
    if (draft === null && returnTo === "add") add.current?.focus();
  }, [draft, returnTo]);

  const closeEditor = () => {
    loads.current += 1;
    preview.stop();
    setReturnTo(draft === null ? null : (draft.id ?? "add"));
    setDraft(null);
    setLocalError(null);
  };

  const chooseFile = async (file: File) => {
    const load = ++loads.current;
    preview.stop();
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
        name: file.name.replace(/\.[^.]+$/, "").slice(0, MAX_SOUND_NAME_LENGTH),
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
    if (preview.playing === sound.id) preview.stop();
    setBusy(true);
    setLocalError(null);
    try {
      await onDelete(sound.id);
    } catch {
      setLocalError(t("settings.soundDeleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const reorder = (soundIds: string[]) => {
    setLocalError(null);
    onReorder(soundIds).catch(() => setLocalError(t("settings.soundOrderFailed")));
  };

  const listen = (key: string, url: string, start: number, end: number) => {
    if (preview.playing === key) {
      preview.stop();
      return;
    }
    preview.play({ key, url, start, end }, () => setLocalError(t("settings.soundPreviewBlocked")));
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

      {draft !== null ? (
        <SoundEditor
          key={draft.revision}
          draft={draft}
          busy={busy}
          previewing={preview.playing === DRAFT_PREVIEW}
          formatSeconds={seconds}
          onEdit={applyEdit}
          onPreview={() => listen(DRAFT_PREVIEW, draft.previewUrl, draft.start, draft.end)}
          onSave={() => void save()}
          onClose={closeEditor}
        />
      ) : (
        <>
          <SettingsSection
            title={t("settings.soundboard")}
            count={`${sounds.length}/${MAX_SOUNDS}`}
            countLabel={t("settings.soundCount", { count: sounds.length, max: MAX_SOUNDS })}
            countTitle={t("settings.soundCountTitle")}
            className="sound-library"
            action={
              <>
                <Button
                  ref={add}
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
            {loading && sounds.length === 0 ? (
              <p className="int-empty">{t("common.loading")}</p>
            ) : sounds.length === 0 ? (
              <div className="asset-empty">
                <Icon name="wave" size={24} />
                <b>{t("settings.noSounds")}</b>
                <span>{t("settings.noSoundsDetail")}</span>
              </div>
            ) : (
              <SoundList
                sounds={sounds}
                editable={supported}
                busy={busy}
                loading={loading}
                previewing={preview.playing}
                formatSeconds={seconds}
                focusEdit={returnTo === "add" ? null : returnTo}
                onPreview={(sound) =>
                  listen(sound.id, sound.url, sound.trimStartSeconds, sound.trimEndSeconds)
                }
                onEdit={(sound) => void edit(sound)}
                onDelete={(sound) => void remove(sound)}
                onReorder={reorder}
              />
            )}
          </SettingsSection>

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
      )}
    </>
  );
}
