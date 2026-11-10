import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UiValue, VoiceValue } from "@/state/hooks";
import { fakeLanguage, fakeUi, fakeVoice, t } from "@/test/roomFakes";

import { VoiceProblemNotice } from "./VoiceProblemNotice";

const mocks = vi.hoisted(() => ({
  voice: null as unknown as VoiceValue,
  ui: null as unknown as UiValue,
  language: null as unknown,
}));

vi.mock("@/state/hooks", () => ({
  useVoice: () => mocks.voice,
  useUi: () => mocks.ui,
  useLanguage: () => mocks.language,
}));

type Problem = NonNullable<VoiceValue["problem"]>;

function problem(kind: Problem["kind"], recoverable = false): Problem {
  return { kind, title: `${kind} title`, message: `${kind} message`, recoverable };
}

function voiceWith(overrides: Partial<VoiceValue>) {
  mocks.voice = fakeVoice({ channelId: "ch-salon", ...overrides });
}

const button = (key: Parameters<typeof t>[0]) => screen.getByRole("button", { name: t(key) });
const buttonNames = () => screen.queryAllByRole("button").map((b) => b.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ui = fakeUi();
  mocks.language = fakeLanguage();
  mocks.voice = fakeVoice();
});

describe("VoiceProblemNotice", () => {
  it("shows nothing while the call is healthy", () => {
    const { container } = render(<VoiceProblemNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it("says what went wrong in the problem's own words", () => {
    voiceWith({ problem: problem("transport") });

    render(<VoiceProblemNotice />);

    expect(screen.getByText("transport title")).toBeInTheDocument();
    expect(screen.getByText("transport message")).toBeInTheDocument();
  });

  it("retries a failed camera, or leaves it be once the camera is on", async () => {
    const user = userEvent.setup();
    voiceWith({ problem: problem("camera") });
    const view = render(<VoiceProblemNotice />);

    await user.click(button("room.retry"));
    expect(mocks.voice.toggleCamera).toHaveBeenCalledOnce();
    await user.click(button("room.cameraSettings"));
    expect(mocks.ui.openModal).toHaveBeenCalledExactlyOnceWith("voice");

    voiceWith({
      problem: problem("camera"),
      call: { cameraOn: true } as VoiceValue["call"],
    });
    view.rerender(<VoiceProblemNotice />);
    expect(buttonNames()).toEqual([t("room.cameraSettings")]);
  });

  it("offers to join again when a microphone failure cost the call its audio", async () => {
    const user = userEvent.setup();
    voiceWith({ problem: problem("mic-denied") });
    render(<VoiceProblemNotice />);

    expect(buttonNames()).toEqual([t("room.joinAgain"), t("room.micSettings")]);
    await user.click(button("room.micSettings"));
    expect(mocks.ui.openModal).toHaveBeenCalledExactlyOnceWith("voice");
  });

  it("offers only the settings when the microphone can be fixed inside the call", () => {
    voiceWith({ problem: problem("mic-unavailable", true) });

    render(<VoiceProblemNotice />);

    expect(buttonNames()).toEqual([t("room.micSettings")]);
  });

  it("retries a screen share that did not start, but not one that is running", () => {
    voiceWith({ problem: problem("screen-share") });
    const view = render(<VoiceProblemNotice />);
    expect(buttonNames()).toEqual([t("room.retry"), t("room.qualitySettings")]);

    voiceWith({ problem: problem("screen-share"), localShare: true });
    view.rerender(<VoiceProblemNotice />);
    expect(buttonNames()).toEqual([t("room.qualitySettings")]);
  });

  it("dials again at once when the connection failed outright", async () => {
    const user = userEvent.setup();
    voiceWith({
      problem: problem("signaling"),
      state: { connection: "failed" } as VoiceValue["state"],
    });
    render(<VoiceProblemNotice />);

    await user.click(button("room.reconnect"));

    expect(mocks.voice.join).toHaveBeenCalledExactlyOnceWith("ch-salon");
    expect(mocks.voice.leave).not.toHaveBeenCalled();
  });

  it("leaves a half-working connection before it dials again", async () => {
    const user = userEvent.setup();
    voiceWith({
      problem: problem("transport"),
      state: { connection: "connected" } as VoiceValue["state"],
    });
    render(<VoiceProblemNotice />);

    await user.click(button("room.reconnect"));

    await waitFor(() => expect(mocks.voice.join).toHaveBeenCalledExactlyOnceWith("ch-salon"));
    expect(mocks.voice.leave).toHaveBeenCalledOnce();
  });

  it("has no way to reconnect when there is no call to reconnect to", () => {
    voiceWith({ problem: problem("ice-config"), channelId: null });

    render(<VoiceProblemNotice />);

    expect(buttonNames()).toEqual([]);
  });

  it("centres a notice for a call another device took over, with nothing to press", () => {
    voiceWith({ problem: problem("session-replaced") });

    const { container } = render(<VoiceProblemNotice />);

    expect(container.firstElementChild).toHaveClass("voice-problem-slot", "centered");
    expect(buttonNames()).toEqual([]);
  });
});
