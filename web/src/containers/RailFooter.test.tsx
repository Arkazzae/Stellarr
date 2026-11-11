import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { RailAccount, RailVoiceDock } from "./RailFooter";

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);

beforeEach(resetStubs);

describe("RailVoiceDock", () => {
  beforeEach(() => {
    setStubs({
      voice: {
        call: {
          channelId: "c-salon",
          channelName: "Salon",
          startedAt: Date.now(),
          muted: false,
          deafened: false,
          cameraOn: false,
          cameraPending: false,
          sharing: false,
          latencyMs: 40,
          connectionQuality: "good",
          headline: "connected",
        },
      },
    });
  });

  it("leaves the call through the ui", async () => {
    const user = userEvent.setup();
    render(<RailVoiceDock />);

    await user.click(screen.getByRole("button", { name: "Rozłącz" }));

    expect(stubs.ui.leaveCall).toHaveBeenCalledTimes(1);
  });

  it("stores the next noise suppression mode in the voice settings", async () => {
    const user = userEvent.setup();
    render(<RailVoiceDock />);

    await user.click(
      screen.getByRole("button", { name: "Tłumienie: wyłączone. Następne: RNNoise." }),
    );

    expect(stubs.ports.voiceSettings.update).toHaveBeenCalledWith({
      noiseSuppression: "rnnoise",
    });
  });
});

describe("RailAccount", () => {
  it("shows the status you chose rather than the one the socket implies", () => {
    setStubs({ session: { presence: "dnd" } });
    render(<RailAccount />);

    expect(screen.getByRole("button", { name: "MajaNie przeszkadzać" })).toBeInTheDocument();
  });

  it("holds a placeholder until the signed-in user is known", () => {
    setStubs({ session: { user: null } });
    render(<RailAccount />);

    expect(screen.getByRole("button", { name: /^…/ })).toBeInTheDocument();
  });

  it("opens the account settings from the only shortcut beside the user", async () => {
    const user = userEvent.setup();
    render(<RailAccount />);

    await user.click(screen.getByRole("button", { name: "Ustawienia użytkownika" }));

    expect(stubs.ui.openModal).toHaveBeenCalledWith("account");
    expect(screen.queryByRole("button", { name: "Wiadomości prywatne" })).not.toBeInTheDocument();
  });
});
