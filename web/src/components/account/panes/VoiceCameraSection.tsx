"use client";

import { useEffect, useId, useRef } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { ErrorNotice } from "@/components/primitives/ErrorNotice";
import type { CameraTest, VoiceSettings } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { DeviceSelect, FormRow, VoiceSection } from "./VoiceFields";

export interface VoiceCameraSectionProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  camera: CameraTest;
}

/** Which camera, and a preview that stays on this device. */
export function VoiceCameraSection({ settings, onChange, camera }: VoiceCameraSectionProps) {
  const { t } = useLanguage();
  const deviceId = useId();

  return (
    <VoiceSection icon="camera" title={t("voice.camera")}>
      <CameraPreview camera={camera} />
      <div className="frm camera-controls">
        <FormRow
          label={t("voice.device")}
          detail={t("voice.cameraDetail")}
          htmlFor={deviceId}
        >
          <DeviceSelect
            id={deviceId}
            label={t("voice.camera")}
            devices={camera.devices}
            value={settings.videoDeviceId}
            defaultLabel={t("voice.systemDefault")}
            onChange={(videoDeviceId) => onChange({ videoDeviceId })}
          />
          {camera.labelsKnown ? null : <p className="pf-count">{t("voice.cameraNamesHint")}</p>}
        </FormRow>

        <FormRow label={t("voice.preview")} detail={t("voice.cameraPreviewDetail")}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={camera.running ? "test-toggle on" : "test-toggle"}
            disabled={camera.starting}
            onClick={() => (camera.running ? camera.stop() : camera.start())}
          >
            <Icon name={camera.running ? "pause" : "camera"} size={15} />
            {camera.running
              ? t("voice.stopPreview")
              : camera.starting
                ? t("voice.openCamera")
                : t("voice.checkCamera")}
          </Button>
          {camera.error === null ? null : (
            <ErrorNotice
              compact
              title={t("voice.cameraNotWorking")}
              message={camera.error}
              icon="camera"
              actions={[{ label: t("common.tryAgain"), onClick: camera.start }]}
            />
          )}
        </FormRow>
      </div>
    </VoiceSection>
  );
}

function CameraPreview({ camera }: { camera: CameraTest }) {
  const { t } = useLanguage();
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    element.srcObject = camera.stream;
    return () => {
      element.srcObject = null;
    };
  }, [camera.stream]);

  return (
    <div className={camera.running ? "camera-preview on" : "camera-preview"}>
      <video ref={video} autoPlay playsInline muted aria-label={t("voice.cameraPreview")} />
      {camera.running ? null : (
        <div className="camera-empty">
          <Icon name="camera" size={24} />
          <span>{camera.starting ? t("voice.openCamera") : t("voice.previewOff")}</span>
        </div>
      )}
    </div>
  );
}
