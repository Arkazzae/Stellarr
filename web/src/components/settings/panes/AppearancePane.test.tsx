import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME, FONTS, PALETTES } from "@/design/themes";

import { AppearancePane, type AppearancePaneProps } from "./AppearancePane";

function props(overrides: Partial<AppearancePaneProps> = {}): AppearancePaneProps {
  return {
    supported: true,
    theme: DEFAULT_THEME,
    resolvedScheme: "dark",
    onChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

describe("AppearancePane", () => {
  it("offers every registered palette and every face in the pack", () => {
    render(<AppearancePane {...props()} />);

    const themes = screen.getByRole("radiogroup", { name: "Motyw" });
    const faces = screen.getByRole("radiogroup", { name: "Krój pisma" });

    for (const palette of PALETTES) {
      expect(themes).toHaveTextContent(palette.label);
    }
    for (const font of FONTS) {
      expect(faces).toHaveTextContent(font.label);
    }
  });

  /*
   * The reason nothing in the component names a colour or a family: each card
   * carries the attributes the app itself is themed by, so the CSS paints the
   * sample. If these ever stop being written, the swatches keep rendering —
   * silently, all in the current theme — which is why they are asserted.
   */
  it("paints each card with the theme it offers", () => {
    render(<AppearancePane {...props({ resolvedScheme: "light" })} />);

    const spotify = screen.getByRole("radio", { name: /Spotify/ });
    expect(spotify).toHaveAttribute("data-theme", "spotify");
    expect(spotify).toHaveAttribute("data-scheme", "light");

    expect(screen.getByRole("radio", { name: /JetBrains Mono/ })).toHaveAttribute(
      "data-font",
      "jetbrains-mono",
    );
  });

  it("changes one axis at a time", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<AppearancePane {...p} />);

    await user.click(screen.getByRole("radio", { name: /Spotify/ }));
    // A preset is a palette and nothing else — picking one may not quietly
    // take back the face or the density someone chose.
    expect(p.onChange).toHaveBeenCalledWith({
      palette: "spotify",
      accent: "#1db954",
    });

    await user.click(screen.getByRole("radio", { name: /Source Sans 3/ }));
    expect(p.onChange).toHaveBeenCalledWith({ font: "source-sans-3" });

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
      theme: { ...DEFAULT_THEME, font: "jetbrains-mono" },
    });
    render(<AppearancePane {...changed} />);

    await user.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    expect(changed.onReset).toHaveBeenCalledTimes(1);
  });

  it("marks the current choice for something other than colour", () => {
    render(
      <AppearancePane
        {...props({ theme: { ...DEFAULT_THEME, font: "jetbrains-mono" } })}
      />,
    );

    expect(screen.getByRole("radio", { name: /Midnight/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /JetBrains Mono/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Outfit/ })).not.toBeChecked();
  });

  it("lets the accent change independently and restores the preset colour", async () => {
    const user = userEvent.setup();
    const p = props({ theme: { ...DEFAULT_THEME, accent: "#ff3366" } });
    render(<AppearancePane {...p} />);

    const accent = screen.getByLabelText("Kolor akcentu");
    fireEvent.change(accent, { target: { value: "#1db954" } });
    expect(p.onChange).toHaveBeenLastCalledWith({ accent: "#1db954" });

    await user.click(screen.getByRole("button", { name: "Kolor motywu" }));
    expect(p.onChange).toHaveBeenLastCalledWith({ accent: DEFAULT_THEME.accent });
  });

  it("shows every colour role in the selected full palette", async () => {
    const user = userEvent.setup();
    render(
      <AppearancePane
        {...props({
          theme: { ...DEFAULT_THEME, palette: "spotify", accent: "#1db954" },
        })}
      />,
    );

    await user.click(screen.getByText(/Pełna paleta/));
    expect(screen.getByText("Najciemniejsze")).toBeInTheDocument();
    expect(screen.getAllByText("#1db954")).toHaveLength(4);
    expect(screen.getByText("rgba(255, 255, 255, 0.06)")).toBeInTheDocument();
  });
});
