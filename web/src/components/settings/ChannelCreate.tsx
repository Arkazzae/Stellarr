"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { channelLabel } from "@/components/settings/channelSettingsModel";
import { CreateDialog } from "@/components/settings/CreateDialog";
import { toChannelSlug } from "@/lib/format";
import type { ChannelKind, NewChannel } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** A channel already in the rail, drawn around the new one for context. */
export interface RailChannel {
  id: string;
  name: string;
  kind: ChannelKind;
  sectionId?: string;
}

export interface ChannelCreateProps {
  open: boolean;
  onClose: () => void;
  /** Which caption's "+" was pressed; the new row starts in that group. */
  kind: ChannelKind;
  /** The server the channel is made in, at the top of the rail slice. */
  serverName: string;
  /** False when this member may not manage channels: the slice stays legible and read-only. */
  supported: boolean;
  sections: readonly { id: string; name: string }[];
  /** The server's channels in rail order. */
  channels: readonly RailChannel[];
  onCreate: (input: NewChannel) => Promise<void>;
}

/** One group of the rail: the two kind groups of unsectioned channels, then each section. */
interface Group {
  key: string;
  caption: string;
  sectionId: string;
  /** The kind a group of unsectioned channels holds; a section holds both. */
  kind: ChannelKind | null;
  channels: readonly RailChannel[];
}

type Focus = "glyph" | "input";

/**
 * The "+" beside a rail caption, as a slice of the rail itself: the server's
 * groups in their real order, and a new row typed where the channel will sit.
 * The row's mark switches it between text and voice, which in an unsectioned
 * rail also moves it between the two kind groups, and the "+" beside another
 * group carries it there. Enter creates it.
 */
export function ChannelCreate({
  open,
  onClose,
  kind,
  serverName,
  supported,
  sections,
  channels,
  onCreate,
}: ChannelCreateProps) {
  const { t } = useLanguage();
  const hintId = useId();
  const errorId = useId();
  const glyphRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [chosenKind, setChosenKind] = useState<ChannelKind>(kind);
  const [sectionId, setSectionId] = useState("");
  const [focus, setFocus] = useState<{ target: Focus } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset while rendering, not in an effect, so the "+" beside the voice
  // caption never opens with the row where the previous press left it.
  const [previous, setPrevious] = useState({ kind, open });
  if (previous.kind !== kind || previous.open !== open) {
    setPrevious({ kind, open });
    setChosenKind(kind);
    setError(null);
    if (!open) {
      setName("");
      setSectionId("");
      setSubmitting(false);
    }
  }

  // Moving the row renders it inside another group, so the control that moved
  // it is a new element: focus is put back on it, and the row is scrolled to.
  useEffect(() => {
    if (focus === null) return;
    (focus.target === "glyph" ? glyphRef : inputRef).current?.focus();
    rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focus]);

  const slug = toChannelSlug(name);
  const locked = !supported || submitting;
  const voice = chosenKind === "voice";
  const reshaped = slug.length > 0 && name.trim() !== slug;

  const groups: Group[] = [
    {
      key: "text",
      caption: t("shell.textChannels"),
      sectionId: "",
      kind: "text",
      channels: channels.filter((item) => item.kind === "text" && item.sectionId === undefined),
    },
    {
      key: "voice",
      caption: t("shell.voiceChannels"),
      sectionId: "",
      kind: "voice",
      channels: channels.filter((item) => item.kind === "voice" && item.sectionId === undefined),
    },
    ...sections.map((section) => ({
      key: `section:${section.id}`,
      caption: section.name,
      sectionId: section.id,
      kind: null,
      // The rail lists a section's text channels before its voice ones.
      channels: [
        ...channels.filter((item) => item.sectionId === section.id && item.kind === "text"),
        ...channels.filter((item) => item.sectionId === section.id && item.kind === "voice"),
      ],
    })),
  ];
  const here = sectionId === "" ? chosenKind : `section:${sectionId}`;

  const moveTo = (group: Group) => {
    setSectionId(group.sectionId);
    if (group.kind !== null) setChosenKind(group.kind);
    setFocus({ target: "input" });
  };

  const switchKind = () => {
    setChosenKind(voice ? "text" : "voice");
    setFocus({ target: "glyph" });
  };

  const submit = async () => {
    if (locked || slug.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: slug,
        kind: chosenKind,
        ...(sectionId === "" ? {} : { sectionId }),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("channel.createFailed"));
      setFocus({ target: "input" });
    } finally {
      setSubmitting(false);
    }
  };

  const newRow = (
    <div ref={rowRef} className="ch-place-row new" data-locked={locked || undefined}>
      <button
        ref={glyphRef}
        type="button"
        className="ch-place-glyph"
        aria-label={voice ? t("channel.makeText") : t("channel.makeVoice")}
        title={voice ? t("channel.makeText") : t("channel.makeVoice")}
        disabled={locked}
        onClick={switchKind}
      >
        {voice ? <Icon name="speaker" size={14} /> : "#"}
      </button>
      <input
        ref={inputRef}
        className="ch-place-input"
        type="text"
        value={name}
        maxLength={60}
        // Not a sample name: one that already sits in the rail right above it
        // would read as a duplicate.
        placeholder={t("channel.newPlaceholder")}
        aria-label={t("channel.name")}
        aria-invalid={error !== null || undefined}
        aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
        disabled={locked}
        required
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
      />
    </div>
  );

  const rows = (group: Group) => {
    const drawn = group.channels.map((item) => (
      <div key={item.id} className="ch-place-row">
        <span className="ch-place-mark" aria-hidden="true">
          {item.kind === "voice" ? <Icon name="speaker" size={14} /> : "#"}
        </span>
        <span className="ch-place-name">{item.name}</span>
      </div>
    ));
    if (group.key !== here) return drawn;
    // A new text channel joins a section after its text channels, as the rail
    // will sort it; anything else joins the end of its group.
    const at =
      group.kind === null && !voice
        ? group.channels.filter((item) => item.kind === "text").length
        : drawn.length;
    return [...drawn.slice(0, at), <Fragment key="new">{newRow}</Fragment>, ...drawn.slice(at)];
  };

  return (
    <CreateDialog
      open={open}
      onClose={onClose}
      title={t("channel.new")}
      detail={t("channel.placeHint")}
      submitLabel={t("channel.create")}
      busy={submitting}
      busyLabel={t("channel.creating")}
      canSubmit={supported && slug.length > 0}
      onSubmit={() => void submit()}
      className="ch-place-modal"
      notes={
        <>
          <p id={hintId} className="ch-place-hint">
            {reshaped
              ? t("channel.willCreate", { name: channelLabel(chosenKind, slug) })
              : t("channel.placeHow")}
          </p>
          {error === null ? null : (
            <p id={errorId} className="ch-place-error" role="alert">
              {error}
            </p>
          )}
        </>
      }
    >
      {supported ? null : <p className="set-note">{t("settings.createChannelUnsupported")}</p>}

      <div className="ch-place" role="group" aria-label={t("channel.placement")}>
        <div className="ch-place-server">{serverName}</div>
        {groups.map((group) => (
          <div
            key={group.key}
            className={group.kind === null ? "ch-place-group section" : "ch-place-group"}
          >
            <div className="ch-place-cap">
              {group.kind === null ? (
                <span className="ch-place-folder" aria-hidden="true">
                  <Icon name="folder" size={12} />
                </span>
              ) : null}
              <span className="ch-place-caption">{group.caption}</span>
              {group.key === here ? null : (
                <button
                  type="button"
                  className="ch-place-move"
                  aria-label={t("channel.moveTo", { group: group.caption })}
                  title={t("channel.moveTo", { group: group.caption })}
                  disabled={locked}
                  onClick={() => moveTo(group)}
                >
                  <Icon name="plus" size={14} />
                </button>
              )}
            </div>
            {rows(group)}
          </div>
        ))}
      </div>
    </CreateDialog>
  );
}
