import type { MessageKey, Translator } from "@/i18n";
import { CAMERA_PROFILES, SCREEN_SHARE_PROFILES } from "@/ports";
import type {
  CameraQualityId,
  OpusProfileId,
  ScreenShareQualityId,
  VoiceSettings,
} from "@/ports";

import type { QualityGroup } from "./QualityMenu";

/** What one of the control bar's arrow drawers shows. */
interface QualityMenuContent {
  summary: string;
  groups: QualityGroup[];
}

type ChangeSettings = (patch: Partial<VoiceSettings>) => void;

// Every list below runs from the lightest profile to the heaviest.
const OPUS_ORDER: readonly OpusProfileId[] = [
  "economy",
  "balanced",
  "clarity",
  "premium",
  "studio",
];
const OPUS: Record<OpusProfileId, { label: MessageKey; bitrate: string }> = {
  economy: { label: "voice.profile.economy", bitrate: "≈32 kb/s" },
  balanced: { label: "voice.profile.balanced", bitrate: "≈64 kb/s" },
  clarity: { label: "voice.profile.clarity", bitrate: "≈96 kb/s" },
  premium: { label: "voice.profile.premium", bitrate: "128 kb/s" },
  studio: { label: "voice.profile.studio", bitrate: "256 kb/s" },
};

const CAMERA_ORDER: readonly CameraQualityId[] = ["economy", "balanced", "sharp"];
const CAMERA_LABEL: Record<CameraQualityId, MessageKey> = {
  economy: "voice.cameraQuality.economy",
  balanced: "voice.cameraQuality.balanced",
  sharp: "voice.cameraQuality.sharp",
};

const SCREEN_ORDER: readonly ScreenShareQualityId[] = [
  "economy",
  "balanced",
  "sharp",
  "ultra",
];
const SCREEN_LABEL: Record<ScreenShareQualityId, MessageKey> = {
  economy: "voice.screen.economy",
  balanced: "voice.screen.balanced",
  sharp: "voice.screen.sharp",
  ultra: "voice.screen.ultra",
};

function choiceGroup<Id extends string>(
  caption: string,
  ids: readonly Id[],
  current: Id,
  describe: (id: Id) => { label: string; detail: string },
  choose: (id: Id) => void,
): QualityGroup {
  return {
    caption,
    options: ids.map((id) => ({
      id,
      ...describe(id),
      selected: id === current,
      onSelect: () => choose(id),
    })),
  };
}

function videoDetail(t: Translator, height: number, framerate: number): string {
  return t("voiceBar.videoDetail", { resolution: `${height}p`, framerate });
}

export function micQualityMenu(
  settings: VoiceSettings,
  t: Translator,
  change: ChangeSettings,
): QualityMenuContent {
  const active = OPUS[settings.opusProfile];
  return {
    summary: t("voiceBar.micSummary", {
      quality: t(active.label),
      bitrate: active.bitrate,
    }),
    groups: [
      choiceGroup(
        t("voiceBar.audioQuality"),
        OPUS_ORDER,
        settings.opusProfile,
        (id) => ({ label: t(OPUS[id].label), detail: OPUS[id].bitrate }),
        (opusProfile) => change({ opusProfile }),
      ),
    ],
  };
}

/** Without camera support there is nothing to choose, so the drawer only explains. */
export function cameraQualityMenu(
  settings: VoiceSettings,
  supported: boolean,
  t: Translator,
  change: ChangeSettings,
): QualityMenuContent {
  if (!supported) {
    return { summary: t("voiceBar.cameraUnavailable"), groups: [] };
  }
  const detailOf = (id: CameraQualityId) =>
    videoDetail(t, CAMERA_PROFILES[id].height, CAMERA_PROFILES[id].maxFramerate);
  const current = settings.cameraQuality;
  return {
    summary: t("voiceBar.cameraSummary", {
      quality: t(CAMERA_LABEL[current]),
      detail: detailOf(current),
    }),
    groups: [
      choiceGroup(
        t("voiceBar.cameraQuality"),
        CAMERA_ORDER,
        current,
        (id) => ({ label: t(CAMERA_LABEL[id]), detail: detailOf(id) }),
        (cameraQuality) => change({ cameraQuality }),
      ),
    ],
  };
}

export function screenQualityMenu(
  settings: VoiceSettings,
  t: Translator,
  change: ChangeSettings,
): QualityMenuContent {
  const detailOf = (id: ScreenShareQualityId) =>
    videoDetail(
      t,
      SCREEN_SHARE_PROFILES[id].maxHeight,
      SCREEN_SHARE_PROFILES[id].maxFramerate,
    );
  const current = settings.screenShareQuality;
  return {
    summary: t("voiceBar.screenSummary", {
      quality: t(SCREEN_LABEL[current]),
      detail: detailOf(current),
    }),
    groups: [
      choiceGroup(
        t("voiceBar.screenProfile"),
        SCREEN_ORDER,
        current,
        (id) => ({ label: t(SCREEN_LABEL[id]), detail: detailOf(id) }),
        (screenShareQuality) => change({ screenShareQuality }),
      ),
    ],
  };
}
