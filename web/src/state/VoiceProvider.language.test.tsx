import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/voice/settings";
import type { Ports } from "@/ports";
import { FakeVoiceClient } from "@/test/fakes";

import { LanguageProvider, useLanguage } from "./LanguageProvider";
import { VoiceProvider } from "./VoiceProvider";

const harness = vi.hoisted(() => ({ ports: undefined as unknown as Ports }));

vi.mock("./AccountProvider", () => ({
  useAccountContext: () => ({ preferences: { joinLeaveSound: true } }),
}));
vi.mock("./DirectoryProvider", () => ({
  useDirectoryContext: () => ({
    channelName: (channelId: string | null) => channelId ?? "",
    occupantsOf: () => [],
  }),
}));
vi.mock("./PortsProvider", () => ({ usePorts: () => harness.ports }));
vi.mock("./SessionProvider", () => ({
  useSessionContext: () => ({ user: { id: "self", displayName: "Self" } }),
}));

const SOUNDBOARD = Object.freeze({
  sounds: [],
  settings: { everyoneCanPlay: true, rateLimited: true },
  canManage: false,
  supported: true,
  loading: false,
  error: null,
});

function SwitchToEnglish() {
  const { update } = useLanguage();
  return (
    <button type="button" onClick={() => update({ locale: "en" })}>
      English
    </button>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "stellarr_locale=; path=/; max-age=0";
  harness.ports = {
    createVoice: vi.fn(() => new FakeVoiceClient()),
    voiceSettings: {
      getSnapshot: () => DEFAULT_SETTINGS,
      subscribe: () => () => {},
      update: vi.fn(),
      reset: vi.fn(),
    },
    soundboard: {
      getSnapshot: () => SOUNDBOARD,
      subscribe: () => () => {},
      setVolume: vi.fn(),
      setDeafened: vi.fn(),
      preparePlayback: vi.fn(),
      cooldownRemaining: () => 0,
      takeJoinAnnouncement: vi.fn(() => false),
      setArrivalsAudible: vi.fn(),
    },
  } as unknown as Ports;
});

describe("the translator the voice client is made with", () => {
  it("answers in the language the person has now, not the one it was made in", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLocale="pl">
        <VoiceProvider>
          <SwitchToEnglish />
        </VoiceProvider>
      </LanguageProvider>,
    );
    await waitFor(() => expect(harness.ports.createVoice).toHaveBeenCalledOnce());
    const { translate } = vi.mocked(harness.ports.createVoice).mock.calls[0]![0];

    expect(translate("voiceClient.joinFailed")).toBe(
      "Nie udało się dołączyć do rozmowy głosowej. Spróbuj ponownie.",
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "English" }));
    });

    expect(translate("voiceClient.joinFailed")).toBe("Could not join the voice call. Try again.");
    expect(harness.ports.createVoice).toHaveBeenCalledOnce();
  });
});
