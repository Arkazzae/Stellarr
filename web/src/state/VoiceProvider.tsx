"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { CallVM, PersonVM, ScreenShareVM } from "@/components/view-models";
import type { Translator } from "@/i18n";
import { playSystemFx } from "@/lib/audio/systemFx";
import { triggerHaptic } from "@/lib/haptics";
import { setAndroidCallActive } from "@/lib/voice/androidCallService";
// `@/ports` re-exports types only, and the idle state is a value that
// `useSyncExternalStore` needs before any client exists.
import { IDLE_VOICE_STATE, type VoiceState } from "@/lib/voice/types";
import type { Sound, SoundboardState } from "@/ports";

import { useAccountContext } from "./AccountProvider";
import { useDirectoryContext } from "./DirectoryProvider";
import { useLanguage } from "./LanguageProvider";
import { usePorts } from "./PortsProvider";
import { useSessionContext } from "./SessionProvider";
import { useCallMediaSession } from "./useCallMediaSession";
import { useVoiceFx } from "./useVoiceFx";
import { useVoiceSettingsSync } from "./useVoiceSettingsSync";
import { VoiceHolder } from "./voiceHolder";
import { voiceProblemForUi, type VoiceProblem } from "./voiceProblems";
import {
  deriveVoiceView,
  shareSourceOf,
  type VoiceRoomPresentation,
} from "./voiceView";

export { voiceErrorForUi, voiceProblemForUi, type VoiceProblem } from "./voiceProblems";
export type { VoiceRoomPresentation } from "./voiceView";

export interface VoiceValue {
  state: VoiceState;
  /** Null unless a call is up; the dock renders `.hidden` for null. */
  call: CallVM | null;
  channelId: string | null;
  /** User-actionable error text, or null. Transport details stay in logs. */
  error: string | null;
  /** The same failure shaped for a persistent, local notice in the room. */
  problem: VoiceProblem | null;
  /** Everyone on the joined channel, with speech and mute applied. */
  people: PersonVM[];
  /** Applies live speech state to people the directory produced. */
  applySpeaking: (people: PersonVM[]) => PersonVM[];
  share: ScreenShareVM | null;
  /** True when the visible share is this user's own screen. */
  localShare: boolean;
  cameraStreams: ReadonlyMap<string, MediaStream>;
  /** Receiver-side volume strips for remote participants. */
  participantVolumes: ReadonlyMap<string, number>;
  /** Which remote strips are gated locally, by user id. */
  participantGates: ReadonlyMap<string, boolean>;
  /** Which remote strips run through a local suppressor, by user id. */
  participantSuppressions: ReadonlyMap<string, boolean>;
  cameraSupported: boolean;
  sounds: Sound[];
  soundboard: SoundboardState;
  /** False disables the tiles: unsupported, in a private call, or cooling down. */
  soundboardEnabled: boolean;
  /** True while the current RTC room belongs to a two-person DM. */
  privateCall: boolean;

  join: (channelId: string, presentation?: VoiceRoomPresentation) => void;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => void;
  toggleShare: () => void;
  watchShare: () => void;
  stopWatchingShare: () => void;
  playSound: (soundId: string) => void;
  setParticipantVolume: (userId: string, volume: number) => void;
  setParticipantGate: (userId: string, gated: boolean) => void;
  setParticipantSuppression: (userId: string, suppressed: boolean) => void;
}

const VoiceContext = createContext<VoiceValue | null>(null);

type PresentedRoom = VoiceRoomPresentation & { id: string };

export function VoiceProvider({ children }: { children: ReactNode }) {
  const ports = usePorts();
  const { t } = useLanguage();
  const { user } = useSessionContext();
  const { preferences } = useAccountContext();
  const { channelName, occupantsOf } = useDirectoryContext();

  const [holder] = useState(() => new VoiceHolder());
  // A join asked for before the client exists is honoured, not lost. It is a
  // ref because nothing renders it: it is read back once, when a client appears.
  const pendingJoin = useRef<string | null>(null);
  const [deafened, setDeafened] = useState(false);
  // The opt-in names one concrete stream, so a new stream is opt-in by
  // construction and no state needs syncing from the render phase.
  const [watchedShareKey, setWatchedShareKey] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<PresentedRoom | null>(null);

  const userId = user?.id ?? null;
  const displayName = user?.displayName ?? "";

  // The client lives through a change of language, so it is given a function
  // that looks the current translator up each time it speaks.
  const latestTranslator = useRef(t);
  useEffect(() => {
    latestTranslator.current = t;
  }, [t]);
  const translate = useCallback<Translator>(
    (key, values) => latestTranslator.current(key, values),
    [],
  );

  useEffect(() => {
    if (userId === null) return;
    const client = ports.createVoice({ userId, displayName, translate });
    holder.attach(client);
    const queued = pendingJoin.current;
    pendingJoin.current = null;
    if (queued !== null) void client.join(queued).catch(() => {});
    return () => holder.detach();
  }, [holder, ports, userId, displayName, translate]);

  const state = useSyncExternalStore(holder.subscribe, holder.getState, () => IDLE_VOICE_STATE);
  const startedAt = useSyncExternalStore(holder.subscribe, holder.getStartedAt, () => null);

  const soundboard = useSyncExternalStore(
    ports.soundboard.subscribe,
    ports.soundboard.getSnapshot,
    ports.soundboard.getSnapshot,
  );
  const soundCooling = useSyncExternalStore(
    ports.soundboard.subscribe,
    () => ports.soundboard.cooldownRemaining() > 0,
    () => false,
  );

  useVoiceSettingsSync({
    holder,
    ports,
    userId,
    arrivals: preferences.joinLeaveSound,
    deafened,
  });

  const callLive =
    state.channelId !== null && state.connection !== "idle" && state.connection !== "failed";
  useEffect(() => {
    setAndroidCallActive(callLive);
  }, [callLive]);
  useEffect(() => () => setAndroidCallActive(false), []);

  const lastLoggedError = useRef<string | null>(null);
  useEffect(() => {
    const error = state.error;
    if (error === null) {
      lastLoggedError.current = null;
      return;
    }
    const key = `${error.kind}:${error.message}`;
    if (lastLoggedError.current === key) return;
    lastLoggedError.current = key;
    console.error(`[voice:${error.kind}] ${error.message}`);
  }, [state.error]);

  const source = useMemo(() => shareSourceOf(state, userId), [state, userId]);
  const watching = source.key !== null && watchedShareKey === source.key;

  useVoiceFx({
    soundboard: ports.soundboard,
    state,
    userId,
    shareOwnerId: source.ownerId,
    arrivals: preferences.joinLeaveSound,
  });

  const room = presentation?.id === state.channelId ? presentation : null;
  const roomName =
    state.channelId === null ? null : (room?.label ?? channelName(state.channelId));

  const join = useCallback(
    (channelId: string, next?: VoiceRoomPresentation) => {
      // Runs inside the click's user activation. Priming Web Audio here lets
      // clips received later from another participant pass the autoplay policy.
      ports.soundboard.preparePlayback();
      setPresentation(next === undefined ? null : { ...next, id: channelId });
      const client = holder.getClient();
      if (
        client?.getSnapshot().channelId === channelId &&
        client.getSnapshot().connection === "connected"
      ) {
        return;
      }
      if (client === null) {
        if (pendingJoin.current === channelId) return;
        pendingJoin.current = channelId;
        triggerHaptic("light");
        return;
      }
      triggerHaptic("light");
      void client.join(channelId).catch(() => {});
    },
    [holder, ports],
  );

  const leave = useCallback(async () => {
    const client = holder.getClient();
    const inCall =
      pendingJoin.current !== null || (client !== null && client.getSnapshot().channelId !== null);
    pendingJoin.current = null;
    if (!inCall) return;
    setPresentation(null);
    triggerHaptic("light");
    setDeafened(false);
    client?.setDeafened(false);
    ports.soundboard.setDeafened(false);
    await client?.leave();
  }, [holder, ports]);

  const toggleMute = useCallback(() => {
    const client = holder.getClient();
    if (client === null) return;
    const muted = !client.getSnapshot().muted;
    client.setMuted(muted);
    triggerHaptic("selection");
    playSystemFx(muted ? "mute" : "unmute");
  }, [holder]);

  const toggleDeafen = useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    holder.getClient()?.setDeafened(next);
    ports.soundboard.setDeafened(next);
    playSystemFx(next ? "mute" : "unmute");
  }, [deafened, holder, ports]);

  // Both capture toggles run straight from the click: the screen picker and the
  // camera prompt need the user gesture.
  const toggleShare = useCallback(() => {
    const client = holder.getClient();
    if (client === null) return;
    void (client.getSnapshot().localScreen !== null
      ? client.stopScreenShare()
      : client.startScreenShare());
  }, [holder]);

  const toggleCamera = useCallback(() => {
    const client = holder.getClient();
    if (client === null || !client.getSnapshot().cameraSupported) return;
    void (client.getSnapshot().localCamera !== null
      ? client.stopCamera()
      : client.startCamera());
  }, [holder]);

  const watchShare = useCallback(() => setWatchedShareKey(source.key), [source.key]);
  const stopWatchingShare = useCallback(() => setWatchedShareKey(null), []);

  const playSound = useCallback(
    (soundId: string) => {
      const channelId = holder.getState().channelId;
      if (channelId === null) return;
      void ports.soundboard.play(soundId, channelId);
    },
    [holder, ports],
  );

  const setParticipantVolume = useCallback(
    (participantId: string, volume: number) =>
      holder.getClient()?.setPeerVolume(participantId, volume),
    [holder],
  );
  const setParticipantGate = useCallback(
    (participantId: string, gated: boolean) =>
      holder.getClient()?.setPeerGate(participantId, gated),
    [holder],
  );
  const setParticipantSuppression = useCallback(
    (participantId: string, suppressed: boolean) =>
      holder.getClient()?.setPeerSuppression(participantId, suppressed),
    [holder],
  );

  const hangUp = useCallback(() => {
    void leave();
  }, [leave]);
  useCallMediaSession({
    title: roomName,
    subtitle:
      room?.privateCall === true ? t("voice.mediaSessionPrivate") : t("voice.mediaSessionChannel"),
    muted: state.muted,
    cameraActive: state.localCamera !== null,
    onToggleMute: toggleMute,
    onHangup: hangUp,
  });

  const view = useMemo(
    () =>
      deriveVoiceView({
        state,
        userId,
        displayName,
        startedAt,
        deafened,
        room,
        roomName,
        watching,
        occupantsOf,
        source,
      }),
    [state, userId, displayName, startedAt, deafened, room, roomName, watching, occupantsOf, source],
  );
  const problem = useMemo(() => voiceProblemForUi(state.error, t), [state.error, t]);

  const value = useMemo<VoiceValue>(
    () => ({
      ...view,
      state,
      channelId: state.channelId,
      error: problem?.message ?? null,
      problem,
      localShare: state.localScreen !== null,
      cameraSupported: state.cameraSupported,
      sounds: soundboard.sounds,
      soundboard,
      soundboardEnabled: !view.privateCall && soundboard.supported && !soundCooling,
      join,
      leave,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      toggleShare,
      watchShare,
      stopWatchingShare,
      playSound,
      setParticipantVolume,
      setParticipantGate,
      setParticipantSuppression,
    }),
    [
      view,
      state,
      problem,
      soundboard,
      soundCooling,
      join,
      leave,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      toggleShare,
      watchShare,
      stopWatchingShare,
      playSound,
      setParticipantVolume,
      setParticipantGate,
      setParticipantSuppression,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoiceContext(): VoiceValue {
  const value = useContext(VoiceContext);
  if (value === null) {
    throw new Error("useVoice must be used inside <VoiceProvider>");
  }
  return value;
}
