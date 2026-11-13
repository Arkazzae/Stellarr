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

    await user.click(within(screen.getByRole("radiogroup", { name: "Kontrast" })).getByRole("radio", { name: /Wysoki/ }));
    expect(p.onChange).toHaveBeenLastCalledWith({ contrast: "high" });

    await user.click(within(screen.getByRole("radiogroup", { name: "Rozmiar tekstu" })).getByRole("radio", { name: /Większy/ }));
    expect(p.onChange).toHaveBeenLastCalledWith({ size: "lg" });
  });

  it("offers the preset colour back only while the accent differs from it", () => {
    const { rerender } = render(<AppearancePane {...props()} />);
    expect(screen.getByRole("button", { name: "Kolor motywu" })).toBeDisabled();

    rerender(<AppearancePane {...props({ theme: { ...DEFAULT_THEME, accent: "#ff3366" } })} />);
    expect(screen.getByRole("button", { name: "Kolor motywu" })).toBeEnabled();
  });

  it("shows the personal accent in the field, not the preset's", () => {
    render(<AppearancePane {...props({ theme: { ...DEFAULT_THEME, accent: "#ff3366" } })} />);

    expect(screen.getByLabelText("Kolor akcentu")).toHaveValue("#ff3366");
    expect(screen.getByText("#ff3366", { selector: "output" })).toBeInTheDocument();
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
