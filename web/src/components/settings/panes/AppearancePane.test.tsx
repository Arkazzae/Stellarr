import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME, PALETTES } from "@/design/themes";

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

describe("AppearancePane", () => {
  it("offers every registered palette", () => {
    render(<AppearancePane {...props()} />);

    const themes = screen.getByRole("radiogroup", { name: "Motyw" });

    for (const palette of PALETTES) {
      expect(themes).toHaveTextContent(palette.label);
    }
  });

  /*
   * The reason nothing in the component names a colour: each card carries the
   * attributes the app itself is themed by, so the CSS paints the sample. If
   * these ever stop being written, the swatches keep rendering — silently, all
   * in the current theme — which is why they are asserted.
   */
  it("paints each card with the theme it offers", () => {
    render(<AppearancePane {...props({ resolvedScheme: "light" })} />);

    const evergreen = screen.getByRole("radio", { name: /Evergreen/ });
    expect(evergreen).toHaveAttribute("data-theme", "evergreen");
    expect(evergreen).toHaveAttribute("data-scheme", "light");
  });

  it("changes one axis at a time", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<AppearancePane {...p} />);

    await user.click(screen.getByRole("radio", { name: /Evergreen/ }));
    // A preset is a palette and nothing else — picking one may not quietly
    // take back the density or the text size someone chose.
    expect(p.onChange).toHaveBeenCalledWith({
      palette: "evergreen",
      accent: "#1db954",
    });

    await user.click(screen.getByRole("radio", { name: /Większy/ }));
    expect(p.onChange).toHaveBeenCalledWith({ size: "lg" });

    await user.click(screen.getByRole("radio", { name: /Zwarta/ }));
    expect(p.onChange).toHaveBeenCalledWith({ density: "compact" });
  });

  it("only offers to restore defaults once something is not default", async () => {
    const user = userEvent.setup();
    const untouched = props();
    const { unmount } = render(<AppearancePane {...untouched} />);

    expect(screen.getByRole("button", { name: "Przywróć domyślne" })).toBeDisabled();
    unmount();

    const changed = props({
      theme: { ...DEFAULT_THEME, size: "lg" },
    });
    render(<AppearancePane {...changed} />);

    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    expect(changed.onReset).toHaveBeenCalledTimes(1);
  });

  it("marks the current choice for something other than colour", () => {
    render(
      <AppearancePane
        {...props({ theme: { ...DEFAULT_THEME, palette: "slate", size: "lg" } })}
      />,
    );

    expect(screen.getByRole("radio", { name: /Slate/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Midnight/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Większy/ })).toBeChecked();
  });

  it("lets the accent change independently and restores the preset colour", async () => {
    const user = userEvent.setup();
    const p = props({ theme: { ...DEFAULT_THEME, accent: "#ff3366" } });
    render(<AppearancePane {...p} />);

    const own = screen.getByLabelText("Własny kolor");
    fireEvent.change(own, { target: { value: "#123456" } });
    expect(p.onChange).toHaveBeenLastCalledWith({ accent: "#123456" });

    const accents = screen.getByRole("radiogroup", { name: "Kolor akcentu" });
    await user.click(within(accents).getByRole("radio", { name: "Zieleń" }));
    expect(p.onChange).toHaveBeenLastCalledWith({ accent: "#1db954" });

    await user.click(within(accents).getByRole("radio", { name: "Kolor motywu" }));
    expect(p.onChange).toHaveBeenLastCalledWith({ accent: DEFAULT_THEME.accent });
  });
});
