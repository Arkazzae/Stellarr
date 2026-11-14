import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME } from "@/design/themes";

import { AppearancePane, type AppearancePaneProps } from "./AppearancePane";

function props(overrides: Partial<AppearancePaneProps> = {}): AppearancePaneProps {
  return {
    theme: DEFAULT_THEME,
    resolvedScheme: "dark",
    onChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

describe("AppearancePane controls", () => {
  it("reports brightness, contrast and text size as separate patches", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<AppearancePane {...p} />);

    await user.click(within(screen.getByRole("radiogroup", { name: "Jasność" })).getByRole("radio", { name: /Jasny/ }));
    expect(p.onChange).toHaveBeenLastCalledWith({ scheme: "light" });

    await user.click(screen.getByRole("switch", { name: "Wysoki kontrast" }));
    expect(p.onChange).toHaveBeenLastCalledWith({ contrast: "high" });

    await user.click(within(screen.getByRole("radiogroup", { name: "Rozmiar tekstu" })).getByRole("radio", { name: /Większy/ }));
    expect(p.onChange).toHaveBeenLastCalledWith({ size: "lg" });
  });

  it("marks the theme's own colour while it is in use, and none of the swatches otherwise", () => {
    const { rerender } = render(<AppearancePane {...props()} />);
    const accents = () => screen.getByRole("radiogroup", { name: "Kolor akcentu" });
    expect(within(accents()).getByRole("radio", { name: "Kolor motywu" })).toBeChecked();

    rerender(<AppearancePane {...props({ theme: { ...DEFAULT_THEME, accent: "#ff3366" } })} />);
    expect(within(accents()).queryByRole("radio", { checked: true })).toBeNull();
  });

  it("shows the personal accent in the picker, not the preset's", () => {
    render(<AppearancePane {...props({ theme: { ...DEFAULT_THEME, accent: "#ff3366" } })} />);

    expect(screen.getByLabelText("Własny kolor")).toHaveValue("#ff3366");
  });

  it("does not offer the theme's own colour twice among the swatches", () => {
    render(<AppearancePane {...props()} />);

    // Midnight's accent is the Stellarr indigo, so the indigo swatch stands down.
    const accents = screen.getByRole("radiogroup", { name: "Kolor akcentu" });
    expect(within(accents).queryByRole("radio", { name: "Indygo" })).toBeNull();
  });

  it("moves through the swatches with the arrow keys, choosing as it goes", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<AppearancePane {...p} />);

    within(screen.getByRole("radiogroup", { name: "Kolor akcentu" }))
      .getByRole("radio", { name: "Kolor motywu" })
      .focus();
    await user.keyboard("{ArrowRight}");
    expect(p.onChange).toHaveBeenLastCalledWith({ accent: "#9146ff" });
    expect(screen.getByRole("radio", { name: "Fiolet" })).toHaveFocus();
  });

  it("sets reduced motion with contrast and text size, and resets it with them", async () => {
    const user = userEvent.setup();
    const onMotion = vi.fn();
    const p = props({ motion: { reducedMotion: true, onChange: onMotion } });
    render(<AppearancePane {...p} />);

    await user.click(screen.getByRole("switch", { name: "Ogranicz animacje" }));
    expect(onMotion).toHaveBeenLastCalledWith(false);

    // The theme is all default, but motion is not, so there is something to restore.
    onMotion.mockClear();
    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    expect(p.onReset).toHaveBeenCalledOnce();
    expect(onMotion).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("leaves reduced motion alone on reset when it is already off", async () => {
    const user = userEvent.setup();
    const onMotion = vi.fn();
    const p = props({
      theme: { ...DEFAULT_THEME, size: "lg" },
      motion: { reducedMotion: false, onChange: onMotion },
    });
    render(<AppearancePane {...p} />);

    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    expect(p.onReset).toHaveBeenCalledOnce();
    expect(onMotion).not.toHaveBeenCalled();
  });
});
