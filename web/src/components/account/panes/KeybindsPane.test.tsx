import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_KEYBINDINGS } from "@/lib/keybinds";

import { KeybindsPane, type KeybindsPaneProps } from "./KeybindsPane";

function setup(overrides: Partial<KeybindsPaneProps> = {}) {
  const props: KeybindsPaneProps = {
    bindings: { ...DEFAULT_KEYBINDINGS },
    recording: null,
    recordingError: null,
    beginRecording: vi.fn(),
    clearBinding: vi.fn(),
    resetBindings: vi.fn(),
    ...overrides,
  };
  render(<KeybindsPane {...props} />);
  return props;
}

describe("KeybindsPane", () => {
  it("shows each chord as separate keys and starts recording a replacement", async () => {
    const user = userEvent.setup();
    const props = setup();

    const mute = screen.getByRole("button", {
      name: "Zmień skrót: Wycisz lub włącz mikrofon",
    });
    expect(mute).toHaveTextContent("CtrlShiftM");
    expect(mute.querySelectorAll("kbd")).toHaveLength(3);

    await user.click(mute);
    expect(props.beginRecording).toHaveBeenCalledExactlyOnceWith("toggleMute");
  });

  it("asks for a key press and explains why the last one was refused", () => {
    setup({
      recording: "toggleMute",
      recordingError: { kind: "conflict", action: "toggleDeafen" },
    });

    expect(screen.getByText("Naciśnij kombinację…")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ta kombinacja jest już przypisana do: Wycisz lub włącz odsłuch.",
    );
    expect(
      screen.getByRole("button", { name: /Anuluj nagrywanie skrótu: Wycisz lub włącz mikrofon/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("reports an error only on the shortcut being recorded", () => {
    setup({ recording: null, recordingError: { kind: "reserved" } });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks a shortcut that has no chord and cannot clear it again", () => {
    setup({ bindings: { ...DEFAULT_KEYBINDINGS, disconnect: null } });

    // The camera has no default chord, and here the call shortcut was cleared too.
    expect(screen.getAllByText("Nieprzypisany")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Wyczyść skrót: Rozłącz rozmowę" }),
    ).toBeDisabled();
  });

  it("clears one shortcut and restores the defaults once they were changed", async () => {
    const user = userEvent.setup();
    const props = setup({ bindings: { ...DEFAULT_KEYBINDINGS, disconnect: null } });

    await user.click(
      screen.getByRole("button", { name: "Wyczyść skrót: Wycisz lub włącz mikrofon" }),
    );
    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));

    expect(props.clearBinding).toHaveBeenCalledExactlyOnceWith("toggleMute");
    expect(props.resetBindings).toHaveBeenCalledOnce();
  });

  it("has nothing to restore while every shortcut is at its default", () => {
    setup();

    expect(screen.getByRole("button", { name: "Przywróć domyślne" })).toBeDisabled();
  });

  it("lists the shortcuts that cannot be changed", () => {
    setup();

    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.getAllByText("Enter")).toHaveLength(2);
  });
});
