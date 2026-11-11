import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME } from "@/design/themes";

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

  it("leaves every control inert when the theme cannot be changed", async () => {
    const user = userEvent.setup();
    const p = props({ supported: false });
    render(<AppearancePane {...p} />);

    expect(screen.getByRole("button", { name: "Przywróć domyślne" })).toBeDisabled();
    expect(screen.getByLabelText("Kolor akcentu")).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Evergreen/ })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /Evergreen/ }));
    expect(p.onChange).not.toHaveBeenCalled();
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
});
