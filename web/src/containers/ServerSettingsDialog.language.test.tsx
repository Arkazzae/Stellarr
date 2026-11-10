import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MessageKey } from "@/i18n";
import type * as Hooks from "@/state/hooks";
import { LanguageProvider } from "@/state/LanguageProvider";

import { ServerSettingsDialog } from "./ServerSettingsDialog";
import type { ServerAdmin } from "./useServerAdmin";

const harness = vi.hoisted(() => ({
  soundboardError: null as MessageKey | null,
  playback: {},
}));

vi.mock("@/components/settings/ServerSettings", () => ({
  ServerSettings: ({ soundboard }: { soundboard: { error: string | null } }) => (
    <output aria-label="soundboard error">{soundboard.error ?? "none"}</output>
  ),
}));

vi.mock("@/state/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  usePorts: () => ({
    admin: { supported: {} },
    directory: {},
    soundboard: {},
    voiceSettings: { subscribe: () => () => {}, getSnapshot: () => harness.playback },
  }),
  useDirectory: () => ({
    channels: [],
    sections: [],
    members: [],
    server: { name: "Home", createdAt: "2026-01-01T00:00:00Z" },
    serverMark: "H",
  }),
  useEmoji: () => ({ emoji: [], refresh: async () => {} }),
  useUi: () => ({ closeModal: () => {} }),
  useVoice: () => ({
    sounds: [],
    soundboard: {
      supported: true,
      canManage: true,
      loading: false,
      settings: { everyoneCanPlay: true, rateLimited: true },
      error: harness.soundboardError,
    },
  }),
}));

const ADMIN = { data: {}, reload: () => {} } as unknown as ServerAdmin;

function shownIn(locale: "pl" | "en", error: MessageKey | null): string | null {
  harness.soundboardError = error;
  render(
    <LanguageProvider initialLocale={locale}>
      <ServerSettingsDialog open {...ADMIN} />
    </LanguageProvider>,
  );
  return screen.getByLabelText("soundboard error").textContent;
}

describe("the soundboard failure in the server settings", () => {
  it("is worded in the reader's language", () => {
    expect(shownIn("en", "soundboard.loadFailed")).toBe("Could not load the server's sounds.");
  });

  it("is worded in Polish for a Polish reader", () => {
    expect(shownIn("pl", "soundboard.loadFailed")).toBe("Nie udało się pobrać dźwięków serwera.");
  });

  it("is absent when nothing went wrong", () => {
    expect(shownIn("en", null)).toBe("none");
  });
});
