import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CameraTest, VoiceSettings } from "@/ports";

import { VoiceCameraCheck } from "./VoiceCameraSection";
import { idleCamera, voiceSettings } from "./voiceTestFixtures";

function setup(options: { settings?: Partial<VoiceSettings>; camera?: Partial<CameraTest> } = {}) {
  const onChange = vi.fn();
  const view = render(
    <VoiceCameraCheck
      settings={{ ...voiceSettings, ...options.settings }}
      onChange={onChange}
      camera={{ ...idleCamera, ...options.camera }}
    />,
  );
  return { onChange, ...view };
}

describe("VoiceCameraCheck", () => {
  it("stores a chosen camera by id and the default as null", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const select = screen.getByLabelText("Kamera");

    await user.selectOptions(select, "camera-1");
    expect(onChange).toHaveBeenLastCalledWith({ videoDeviceId: "camera-1" });

    await user.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith({ videoDeviceId: null });
  });

  it("explains unnamed cameras until a preview has been allowed", () => {
    setup({ camera: { labelsKnown: false } });

    expect(screen.getByText(/Nazwy kamer pokażą się po uruchomieniu podglądu/)).toBeInTheDocument();
  });

  it("starts the preview from the button and stops it while it runs", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const stop = vi.fn();
    const { rerender } = setup({ camera: { start, stop } });

    await user.click(screen.getByRole("button", { name: "Sprawdź kamerę" }));
    expect(start).toHaveBeenCalledOnce();

    rerender(
      <VoiceCameraCheck
        settings={voiceSettings}
        onChange={vi.fn()}
        camera={{ ...idleCamera, running: true, start, stop }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Zatrzymaj podgląd" }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("cannot be clicked twice while the camera is opening", () => {
    setup({ camera: { starting: true } });

    expect(screen.getByRole("button", { name: "Otwieram kamerę…" })).toBeDisabled();
  });

  it("says the preview is off until the camera runs, and not afterwards", () => {
    const { rerender } = setup();
    expect(screen.getByText("Podgląd jest wyłączony")).toBeInTheDocument();

    rerender(
      <VoiceCameraCheck
        settings={voiceSettings}
        onChange={vi.fn()}
        camera={{ ...idleCamera, running: true }}
      />,
    );
    expect(screen.queryByText("Podgląd jest wyłączony")).toBeNull();
  });

  it("shows a failure with a retry", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    setup({ camera: { error: "Kamera jest zajęta.", start } });

    expect(screen.getByText("Kamera jest zajęta.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("plays the camera stream in the preview and lets go of it afterwards", () => {
    const stream = {} as MediaStream;
    const { unmount } = setup({ camera: { running: true, stream } });
    const video = screen.getByLabelText("Podgląd z kamery") as HTMLVideoElement;

    expect(video.srcObject).toBe(stream);

    unmount();
    expect(video.srcObject).toBeNull();
  });

  it("follows the stream when the camera is swapped", () => {
    const first = {} as MediaStream;
    const second = {} as MediaStream;
    const { rerender } = setup({ camera: { running: true, stream: first } });
    const video = screen.getByLabelText("Podgląd z kamery") as HTMLVideoElement;

    rerender(
      <VoiceCameraCheck
        settings={voiceSettings}
        onChange={vi.fn()}
        camera={{ ...idleCamera, running: true, stream: second }}
      />,
    );

    expect(video.srcObject).toBe(second);
  });
});
