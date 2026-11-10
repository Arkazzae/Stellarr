import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { SoundboardPane, type SoundboardPaneProps } from "./SoundboardPane";

vi.mock("@/components/settings/WaveformTrimmer", async () => {
  const actual = await vi.importActual("@/components/settings/WaveformTrimmer");
  return {
    ...actual,
    decodeWaveform: vi.fn().mockResolvedValue({
      duration: 2.4,
      peaks: [0.2, 0.6, 1, 0.5],
    }),
  };
});

const SOUND = {
  id: "drum",
  name: "Bęben",
  glyph: "🥁",
  url: "/sounds/notification.wav",
  durationSeconds: 2.4,
  trimStartSeconds: 0.2,
  trimEndSeconds: 1.8,
};

function props(overrides: Partial<SoundboardPaneProps> = {}): SoundboardPaneProps {
  return {
    supported: true,
    sounds: [SOUND],
    everyoneCanPlay: true,
    onEveryoneCanPlayChange: vi.fn(),
    rateLimited: true,
    onRateLimitedChange: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(undefined),
    playback: { outputVolume: 100, soundboardVolume: 100 },
    onSoundboardVolumeChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SoundboardPane", () => {
  it("uses the shared server-asset empty state", () => {
    const { container } = renderWithConfirm(
      <SoundboardPane {...props({ sounds: [] })} />,
    );

    expect(screen.getByText("Nie ma jeszcze żadnych dźwięków")).toBeVisible();
    expect(container.querySelector(".asset-empty")).toHaveTextContent(
      "Dodaj krótki klip, aby pojawił się na kanałach głosowych.",
    );
    expect(screen.getByLabelText("0 z 48 dźwięków, maksymalnie 15 sekund każdy"))
      .toHaveTextContent("0/48");
  });

  it("presents sounds as a management list with timing and named actions", () => {
    renderWithConfirm(<SoundboardPane {...props()} />);

    expect(screen.getByRole("region", { name: "Dźwięki serwera" })).toHaveTextContent(
      "1/48",
    );
    expect(screen.getByText("1,6 s · źródło 2,4 s")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edytuj dźwięk Bęben" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Usuń dźwięk Bęben" })).toBeVisible();
  });

  it("requires confirmation before deleting a sound", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderWithConfirm(<SoundboardPane {...props({ onDelete })} />);

    const remove = screen.getByRole("button", { name: "Usuń dźwięk Bęben" });
    await user.click(remove);
    expect(screen.getByRole("dialog")).toHaveTextContent("Usunąć dźwięk „Bęben”?");
    await answerConfirm(user, "Anuluj");
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(remove);
    await answerConfirm(user, "Usuń");
    expect(onDelete).toHaveBeenCalledWith("drum");
  });

  it("keeps the catalogue readable without management permission", () => {
    renderWithConfirm(<SoundboardPane {...props({ supported: false })} />);

    expect(screen.getByText("Bęben")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edytuj dźwięk Bęben" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dodaj dźwięk" })).toBeDisabled();
  });

  it("lets an existing emoji picker fill the sound symbol", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    );
    renderWithConfirm(<SoundboardPane {...props()} />);

    await user.click(screen.getByRole("button", { name: "Edytuj dźwięk Bęben" }));
    const openPicker = await screen.findByRole("button", {
      name: "Wybierz emoji dźwięku",
    });
    await user.click(openPicker);

    expect(
      screen.getByRole("dialog", { name: "Wybierz emoji dźwięku" }),
    ).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Szukaj emoji" }), "zaba");
    await user.click(screen.getByRole("option", { name: ":zaba:" }));

    // The symbol control is the emoji itself, not a field to type one into.
    expect(
      screen.getByRole("button", { name: "Wybierz emoji dźwięku" }),
    ).toHaveTextContent("🐸");
    expect(
      screen.queryByRole("dialog", { name: "Wybierz emoji dźwięku" }),
    ).toBeNull();
  });

  it("does not raise emoji search when the sound picker is opened by touch", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    );
    renderWithConfirm(<SoundboardPane {...props()} />);

    await user.click(screen.getByRole("button", { name: "Edytuj dźwięk Bęben" }));
    const trigger = await screen.findByRole("button", {
      name: "Wybierz emoji dźwięku",
    });
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger, { detail: 1 });

    expect(
      screen.getByRole("textbox", { name: "Szukaj emoji" }),
    ).not.toHaveFocus();
  });

  it("seeks after metadata and stops preview from actual media progress", async () => {
    const created: Array<{
      currentTime: number;
      readyState: number;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      onloadedmetadata: (() => void) | null;
      ontimeupdate: (() => void) | null;
      onended: (() => void) | null;
      onerror: (() => void) | null;
    }> = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock(this: (typeof created)[number]) {
        this.currentTime = 0;
        this.readyState = 0;
        this.play = vi.fn(async () => undefined);
        this.pause = vi.fn();
        this.onloadedmetadata = null;
        this.ontimeupdate = null;
        this.onended = null;
        this.onerror = null;
        created.push(this);
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    );
    const user = userEvent.setup();
    renderWithConfirm(<SoundboardPane {...props()} />);
    await user.click(screen.getByRole("button", { name: "Edytuj dźwięk Bęben" }));
    await user.click(await screen.findByRole("button", { name: "Podgląd" }));
    const audio = created[0]!;

    act(() => audio.onloadedmetadata?.());
    await waitFor(() => expect(audio.play).toHaveBeenCalledOnce());
    expect(audio.currentTime).toBe(0.2);

    audio.currentTime = 1.8;
    act(() => audio.ontimeupdate?.());
    expect(audio.pause).toHaveBeenCalledOnce();
  });
});
