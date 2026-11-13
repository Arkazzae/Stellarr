"use client";

import { useMemo, type ReactNode } from "react";

import { Icon } from "@stellarr/ui/icons";
import { PresenceDot } from "@/components/primitives/Avatar";
import { Composer } from "@/components/room/Composer";
import type { ComposerChip } from "@/components/room/ComposerChips";
import type { MessageTranslationOptions } from "@/components/room/attachments/TranslatedTextAttachment";
import type { AttachmentCallbacks } from "@/components/room/parts";
import { Transcript, type TranscriptSectionVM } from "@/components/room/Transcript";
import { ParticipantTiles } from "@/components/voice/ParticipantTiles";
import type { OpenProfile, PersonVM } from "@/components/view-models";
import { translateForDocument } from "@/i18n/defaultLocale";
import { PRESENCE_LABEL, type CustomEmoji } from "@/ports";

export interface DmRoomProps {
  peer: PersonVM;
  sections: TranscriptSectionVM[];
  railOpen: boolean;
  onToggleRail: () => void;
  onSend: (text: string) => Promise<void>;
  hasOlderMessages?: boolean;
  loadingOlderMessages?: boolean;
  onLoadOlderMessages?: () => void;
  /** Somebody is in the conversation's call. */
  callActive: boolean;
  /** You are in it. */
  inCall: boolean;
  onCall: () => void;
  videoOn: boolean;
  onVideoCall: () => void;
  callPeople: PersonVM[];
  cameraStreams: ReadonlyMap<string, MediaStream>;
  localPersonId: string;
  participantVolumes: ReadonlyMap<string, number>;
  onParticipantVolumeChange: (personId: string, volume: number) => void;
  participantGates?: ReadonlyMap<string, boolean>;
  onParticipantGateChange?: (personId: string, gated: boolean) => void;
  participantSuppressions?: ReadonlyMap<string, boolean>;
  onParticipantSuppressionChange?: (personId: string, suppressed: boolean) => void;
  chips: ComposerChip[];
  onAttach: (files: File[]) => void;
  onRemoveChip: (chipId: string) => void;
  onRetryChip: (chipId: string) => void;
  onReorderChips: (from: number, to: number) => void;
  /** From an author in the transcript, from a tile, and from the name in the header. */
  onOpenProfile: OpenProfile;
  /** The server's own emoji: the picker and the reaction bar both offer them. */
  customEmoji?: readonly CustomEmoji[];
  translation?: MessageTranslationOptions;
  /** The same picture, clip and recording actions the channel transcript uses. */
  attachments?: AttachmentCallbacks;
  notificationButton?: ReactNode;
}

/**
 * One conversation.
 *
 * The same room as a channel (header, transcript, composer), with three
 * differences that are the point of the surface: the title is a person, so it
 * carries a presence word; the header offers a call to that person instead of
 * tools for a channel; and the history has a beginning, which is stated once
 * at the top of the scroller rather than assumed.
 */
export function DmRoom({
  peer,
  sections,
  railOpen,
  onToggleRail,
  onSend,
  hasOlderMessages = false,
  loadingOlderMessages = false,
  onLoadOlderMessages,
  callActive,
  inCall,
  onCall,
  videoOn,
  onVideoCall,
  callPeople,
  cameraStreams,
  localPersonId,
  participantVolumes,
  onParticipantVolumeChange,
  participantGates,
  onParticipantGateChange,
  participantSuppressions,
  onParticipantSuppressionChange,
  chips,
  onAttach,
  onRemoveChip,
  onRetryChip,
  onReorderChips,
  onOpenProfile,
  customEmoji,
  translation,
  attachments,
  notificationButton,
}: DmRoomProps) {
  const t = translation?.t ?? translateForDocument;
  const name = peer.displayName;

  // The transcript rebuilds its scroller when the intro changes identity, so
  // the element must stay the same one across unrelated renders.
  const intro = useMemo(
    () => (
      <div className="dm-intro">
        <h3>{name}</h3>
        <p>{t("dm.intro", { name })}</p>
      </div>
    ),
    [name, t],
  );

  const callTitle = inCall ? t("dm.inCall") : t(callActive ? "dm.joinCall" : "dm.startCall");
  const callLabel = inCall
    ? t("dm.connected", { name })
    : t(callActive ? "dm.join" : "dm.call", { name });
  const cameraLabel = t(videoOn ? "voiceBar.cameraStop" : "voiceBar.cameraStart");
  const showTiles = inCall && (videoOn || cameraStreams.size > 0);

  return (
    <main className="room dm-room">
      <header className="room-header">
        <button
          type="button"
          className="burger"
          aria-label={t("dm.showConversations")}
          aria-expanded={railOpen}
          onClick={onToggleRail}
        >
          <Icon name="list" size={18} />
        </button>
        <span className="glyph" aria-hidden="true">
          <Icon name="at" size={18} />
        </span>
        <h2>{name}</h2>
        {/* Shape and word, not colour: the dot the faces wear, with the word it
            stands for beside it. */}
        <span className="dm-presence">
          <PresenceDot presence={peer.presence} />
          {t(PRESENCE_LABEL[peer.presence])}
        </span>

        <div className="pill-bar auto" role="toolbar" aria-label={t("dm.toolbar")}>
          {notificationButton}
          <button
            type="button"
            className={inCall ? "pill-btn on" : "pill-btn"}
            title={callTitle}
            aria-label={callLabel}
            aria-pressed={inCall}
            onClick={onCall}
          >
            <Icon name="phone" size={16} />
          </button>
          <button
            type="button"
            className={videoOn ? "pill-btn on" : "pill-btn"}
            title={cameraLabel}
            aria-label={cameraLabel}
            aria-pressed={videoOn}
            onClick={onVideoCall}
          >
            <Icon name="camera" size={16} />
          </button>
        </div>
      </header>

      <div className="view active">
        {showTiles ? (
          <div className="dm-video-stage">
            <ParticipantTiles
              people={callPeople}
              cameraStreams={cameraStreams}
              localPersonId={localPersonId}
              participantVolumes={participantVolumes}
              onParticipantVolumeChange={onParticipantVolumeChange}
              participantGates={participantGates}
              onParticipantGateChange={onParticipantGateChange}
              participantSuppressions={participantSuppressions}
              onParticipantSuppressionChange={onParticipantSuppressionChange}
              onOpenProfile={onOpenProfile}
            />
          </div>
        ) : null}
        <Transcript
          sections={sections}
          label={t("dm.messagesWith", { name })}
          onOpenAuthor={onOpenProfile}
          customEmoji={customEmoji}
          translation={translation}
          attachments={attachments}
          intro={intro}
          hasOlder={hasOlderMessages}
          loadingOlder={loadingOlderMessages}
          onLoadOlder={onLoadOlderMessages}
        />
        <Composer
          channelName={name}
          placeholder={t("dm.writeTo", { name })}
          chips={chips}
          onSubmit={onSend}
          onAttach={onAttach}
          onRemoveChip={onRemoveChip}
          onRetryChip={onRetryChip}
          onReorderChips={onReorderChips}
          customEmoji={customEmoji}
          locale={translation?.locale}
          t={t}
        />
      </div>
    </main>
  );
}
