"use client";

import { useCallback, useSyncExternalStore } from "react";

import { Composer } from "@/components/room/Composer";
import { useGifsEnabled } from "@/hooks/useGifsEnabled";
import type { Translator } from "@/i18n";
import { captureMicrophone, MicCaptureError } from "@/lib/voice/micPipeline";
import { VoiceMessageCaptureError } from "@/ports";
import {
  useChat,
  useDirectory,
  useEmoji,
  useLanguage,
  usePorts,
  useSession,
} from "@/state/hooks";

interface RoomComposerProps {
  channelName: string;
  /** The thread being answered, or null for the channel itself. */
  threadRootId: string | null;
}

/**
 * The message field for the open channel, or for the open thread when there is
 * one. A thread is written to the thread, so it neither names a reply target
 * nor offers to cancel one.
 */
export function RoomComposer({ channelName, threadRootId }: RoomComposerProps) {
  const chat = useChat();
  const giphyApiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY ?? "";
  // Cockpit can turn GIFs off; then the composer offers no GIF button.
  const gifsEnabled = useGifsEnabled(giphyApiKey);
  const { user } = useSession();
  const { members } = useDirectory();
  const { emoji: customEmoji } = useEmoji();
  const { locale, t } = useLanguage();
  const ports = usePorts();

  // The device settings the call also runs on, so a recording uses the
  // microphone and processing the reader chose.
  const voiceSettings = useSyncExternalStore(
    ports.voiceSettings.subscribe,
    ports.voiceSettings.getSnapshot,
    ports.voiceSettings.getSnapshot,
  );

  const openVoiceMessageMicrophone = useCallback(async () => {
    try {
      const capture = await captureMicrophone(voiceSettings, { translate: t });
      return {
        stream: capture.stream,
        inputTrack: capture.rawTrack,
        dispose: () => capture.dispose(),
      };
    } catch (cause) {
      throw new VoiceMessageCaptureError(captureFailure(cause, t));
    }
  }, [t, voiceSettings]);

  const inThread = threadRootId !== null;
  const reply = chat.replyingTo;

  return (
    <Composer
      channelName={channelName}
      recordingScope={
        inThread ? `${chat.channelId ?? "no-channel"}:thread:${threadRootId}` : chat.channelId
      }
      chips={chat.chips}
      onSubmit={chat.send}
      openVoiceMessageMicrophone={openVoiceMessageMicrophone}
      onSendVoice={chat.sendVoice}
      onAttach={chat.attach}
      onRemoveChip={chat.removeChip}
      onRetryChip={chat.retryChip}
      onReorderChips={chat.reorderChips}
      onTyping={chat.notifyTyping}
      customEmoji={customEmoji}
      mentionCandidates={members}
      giphyApiKey={giphyApiKey}
      giphyCustomerId={user?.id ?? "stellarr"}
      {...(gifsEnabled ? { onGif: chat.sendGif } : {})}
      locale={locale}
      t={t}
      {...(inThread
        ? { placeholder: t("room.threadPlaceholder"), replyingTo: null }
        : {
            replyingTo:
              reply === null
                ? null
                : { id: reply.id, authorName: reply.authorName, preview: reply.preview },
            onCancelReply: chat.cancelReply,
          })}
    />
  );
}

/** The sentence for why the microphone could not be opened. */
function captureFailure(cause: unknown, t: Translator): string {
  if (!(cause instanceof MicCaptureError)) return t("recorder.startFailed");
  switch (cause.kind) {
    case "denied":
      return t("recorder.allowMic");
    case "unsupported":
      return t("recorder.unsupported");
    default:
      return t("voice.microphoneNotWorking");
  }
}
