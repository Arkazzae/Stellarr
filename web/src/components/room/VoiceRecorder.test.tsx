import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/primitives/Modal";

import { VoiceRecorder } from "./VoiceRecorder";

/** Long enough for a recording to pass the half-second minimum. */
const LONG_ENOUGH_MS = 550;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function microphone() {
  const track = { stop: vi.fn(), contentHint: "", onended: null as (() => void) | null };
  const dispose = vi.fn(() => track.stop());
  const capture = {
    stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream,
    inputTrack: track,
    dispose,
  };
  return { track, dispose, capture, open: vi.fn().mockResolvedValue(capture) };
}

/**
 * Stands in for MediaRecorder. `supports` decides which containers the
 * "browser" can record; `emptyTake` makes a recording that captured nothing.
 */
function stubRecorder({
  supports = () => true,
  emptyTake = false,
}: { supports?: (type: string) => boolean; emptyTake?: boolean } = {}) {
  const created: { mimeType: string; state: RecordingState }[] = [];

  class RecorderMock {
    static isTypeSupported = vi.fn(supports);
    state: RecordingState = "inactive";
    mimeType: string;
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onstop: (() => void) | null = null;

    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
      this.mimeType = options?.mimeType ?? "audio/webm";
      created.push(this);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      if (!emptyTake) {
        this.ondataavailable?.({
          data: new Blob(["voice-bytes"], { type: this.mimeType }),
        } as BlobEvent);
      }
      this.onstop?.();
    }
  }

  vi.stubGlobal("MediaRecorder", RecorderMock);
  return created;
}

function renderRecorder(open: ReturnType<typeof microphone>["open"]) {
  const onCancel = vi.fn();
  const onSend = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <VoiceRecorder openMicrophone={open} onCancel={onCancel} onSend={onSend} />,
  );
  return { ...view, onCancel, onSend };
}

type User = ReturnType<typeof userEvent.setup>;

async function stopRecording(user: User) {
  await user.click(await screen.findByRole("button", { name: "Zakończ nagrywanie" }));
}

/** Records for just over the minimum, then stops. */
async function recordSomething(user: User) {
  await screen.findByRole("button", { name: "Zakończ nagrywanie" });
  await wait(LONG_ENOUGH_MS);
  await stopRecording(user);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VoiceRecorder file", () => {
  it.each([
    ["every container", () => true, "audio/webm", "webm"],
    ["only ogg", (type: string) => type.startsWith("audio/ogg"), "audio/ogg", "ogg"],
    ["only mp4", (type: string) => type === "audio/mp4", "audio/mp4", "m4a"],
    ["no way to ask for one", () => false, "audio/webm", "webm"],
  ])(
    "names the file after the container the browser recorded (%s)",
    async (_label, supports, type, extension) => {
      stubRecorder({ supports });
      const user = userEvent.setup();
      const { open } = microphone();
      const { onSend } = renderRecorder(open);

      await recordSomething(user);
      await user.click(await screen.findByRole("button", { name: "Wyślij wiadomość głosową" }));

      const [file, duration] = onSend.mock.calls[0] as [File, number];
      expect(file.type).toContain(type);
      expect(file.name).toMatch(
        new RegExp(`^wiadomosc-glosowa-\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z\\.${extension}$`),
      );
      expect(duration).toBeGreaterThanOrEqual(0.5);
    },
  );
});

describe("VoiceRecorder cancelling", () => {
  it("releases the microphone and sends nothing when cancelled mid-recording", async () => {
    const recorders = stubRecorder();
    const user = userEvent.setup();
    const { open, dispose } = microphone();
    const { onCancel, onSend } = renderRecorder(open);

    await screen.findByRole("button", { name: "Zakończ nagrywanie" });
    await user.click(screen.getByRole("button", { name: "Anuluj wiadomość głosową" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(recorders[0]?.state).toBe("inactive");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByText("Nagranie gotowe")).toBeNull();
  });

  it("cancels on Escape", async () => {
    stubRecorder();
    const user = userEvent.setup();
    const { open, dispose } = microphone();
    const { onCancel, onSend } = renderRecorder(open);

    await screen.findByRole("button", { name: "Zakończ nagrywanie" });
    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("leaves Escape to a dialog opened over it, and keeps recording", async () => {
    stubRecorder();
    const user = userEvent.setup();
    const { open, dispose } = microphone();
    const onCancel = vi.fn();
    const onDialogClose = vi.fn();
    const tree = (dialogOpen: boolean) => (
      <>
        <VoiceRecorder openMicrophone={open} onCancel={onCancel} onSend={vi.fn()} />
        <Modal
          open={dialogOpen}
          onClose={onDialogClose}
          labelledBy="dialog-title"
          className="sv-wrap"
        >
          <h2 id="dialog-title">Ustawienia</h2>
        </Modal>
      </>
    );
    const { rerender } = render(tree(false));
    await screen.findByRole("button", { name: "Zakończ nagrywanie" });

    rerender(tree(true));
    await user.keyboard("{Escape}");

    expect(onDialogClose).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("releases a microphone that opens after the recorder was cancelled", async () => {
    const recorders = stubRecorder();
    const user = userEvent.setup();
    const { capture, dispose } = microphone();
    let grant: (value: typeof capture) => void = () => {};
    const open = vi.fn(() => new Promise<typeof capture>((resolve) => { grant = resolve; }));
    const { onCancel } = renderRecorder(open);

    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "Anuluj wiadomość głosową" }));
    expect(onCancel).toHaveBeenCalledOnce();

    grant(capture);

    await waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(recorders).toHaveLength(0);
  });

  it("releases the microphone when the recorder is removed mid-recording", async () => {
    const recorders = stubRecorder();
    const { open, dispose } = microphone();
    const { unmount } = renderRecorder(open);

    await screen.findByRole("button", { name: "Zakończ nagrywanie" });
    unmount();

    expect(dispose).toHaveBeenCalledOnce();
    expect(recorders[0]?.state).toBe("inactive");
  });

  it("discards a finished recording without sending it", async () => {
    stubRecorder();
    const user = userEvent.setup();
    const { open } = microphone();
    const { onCancel, onSend } = renderRecorder(open);

    await recordSomething(user);
    await user.click(await screen.findByRole("button", { name: "Usuń nagranie" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("VoiceRecorder failures", () => {
  it("offers a retry when nothing was captured, and records again on it", async () => {
    stubRecorder({ emptyTake: true });
    const user = userEvent.setup();
    const { open } = microphone();
    renderRecorder(open);

    await stopRecording(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Nagranie jest zbyt krótkie");
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("button", { name: "Zakończ nagrywanie" })).toBeVisible();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("explains a refused microphone", async () => {
    stubRecorder();
    const open = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    renderRecorder(open);

    expect(await screen.findByRole("alert")).toHaveTextContent("Zezwól Stellarr na dostęp do mikrofonu");
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeVisible();
  });

  it("keeps the recording when sending fails, so it can be sent again", async () => {
    stubRecorder();
    const user = userEvent.setup();
    const { open } = microphone();
    const { onSend, onCancel } = renderRecorder(open);
    onSend.mockRejectedValueOnce(new Error("offline"));

    await recordSomething(user);
    await user.click(await screen.findByRole("button", { name: "Wyślij wiadomość głosową" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nagranie zostało zachowane");
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Wyślij wiadomość głosową" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
