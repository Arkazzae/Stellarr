import { render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { describe, expect, it } from "vitest";

import { Icon, IconVariantProvider, type IconName, type IconVariant } from "./Icon";
import { ICON_GLYPHS, ICON_VARIANTS, iconPaths, type IconGlyph } from "./paths";
import { GLYPHS } from "./source/glyphs";

const NAMES = Object.keys(ICON_GLYPHS) as IconName[];

function renderIcon(
  name: IconName,
  props: { size?: number; variant?: IconVariant; className?: string; style?: CSSProperties } = {},
) {
  const { container } = render(<Icon name={name} {...props} />);
  return container.firstElementChild as HTMLElement | SVGElement;
}

const drawn = (svg: Element) => [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d"));

describe("Icon", () => {
  it("draws every glyph of both variants as stroked paths", () => {
    for (const variant of ICON_VARIANTS) {
      for (const name of NAMES) {
        const svg = renderIcon(name, { variant });

        expect(drawn(svg), `${name} ${variant}`).toEqual(iconPaths(name, variant));
        for (const path of svg.querySelectorAll("path")) {
          expect(path.getAttribute("stroke")).toBe("currentColor");
          expect(path.getAttribute("stroke-width")).toBe("1.5");
          expect(path.getAttribute("stroke-linecap")).toBe("round");
          expect(path.getAttribute("stroke-linejoin")).toBe("round");
        }
      }
    }
  });

  it("draws the broken variant unless told otherwise", () => {
    expect(drawn(renderIcon("headphones"))).toEqual(iconPaths("headphones", "broken"));
    expect(drawn(renderIcon("headphones", { variant: "linear" }))).toEqual(iconPaths("headphones", "linear"));
  });

  it("takes the variant of the nearest provider, and a prop over it", () => {
    const { container } = render(
      <IconVariantProvider variant="linear">
        <Icon name="mic" />
        <Icon name="mic" variant="broken" />
      </IconVariantProvider>,
    );
    const [inherited, own] = [...container.querySelectorAll("svg")];

    expect(drawn(inherited!)).toEqual(iconPaths("mic", "linear"));
    expect(drawn(own!)).toEqual(iconPaths("mic", "broken"));
  });

  it("sizes the box and passes the class on", () => {
    const svg = renderIcon("mic", { size: 22, className: "mic-glyph" });

    expect(svg).toHaveAttribute("width", "22");
    expect(svg).toHaveAttribute("height", "22");
    expect(svg).toHaveClass("mic-glyph");
    expect(renderIcon("mic")).toHaveAttribute("width", "16");
  });

  it("stays out of the accessibility tree", () => {
    expect(renderIcon("mic")).toHaveAttribute("aria-hidden", "true");
    expect(renderIcon("noiseRnnoise")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders every noise mode as a scalable glyph without an image request", () => {
    for (const name of ["noiseOff", "noiseBrowser", "noiseSpeex", "noiseRnnoise", "noiseGtcrn"] as const) {
      const node = renderIcon(name, { size: 24, className: "noise-icon" });

      expect(node.tagName).toBe("svg");
      expect(node).toHaveClass("noise-icon");
      expect(node).toHaveAttribute("viewBox", "0 0 24 24");
      expect(node).toHaveAttribute("width", "24");
      expect(node.querySelector("image")).toBeNull();
    }
  });

  it("lets an app size the box in its own unit", () => {
    const svg = renderIcon("gear", { size: 20, style: { width: "1.25rem", height: "1.25rem" } });

    // The inline style overrides the width and height attributes in a browser.
    // jsdom computes SVG sizes from the attributes, so read the declaration.
    expect(svg).toHaveAttribute("width", "20");
    expect(svg.style.width).toBe("1.25rem");
    expect(svg.style.height).toBe("1.25rem");
  });
});

describe("ICON_GLYPHS", () => {
  it("is the build of source/glyphs.ts (run npm run icons:build -w @stellarr/ui)", () => {
    expect(NAMES).toEqual(Object.keys(GLYPHS));
    for (const name of NAMES) {
      for (const variant of ICON_VARIANTS) {
        const source = GLYPHS[name].map((s) => (typeof s === "string" ? s : s[variant]));
        expect(iconPaths(name, variant), `${name} ${variant}`).toEqual(source);
      }
    }
  });

  it("keeps a broken form only where it differs from the linear one", () => {
    for (const name of NAMES) {
      const glyph: IconGlyph = ICON_GLYPHS[name];
      if (glyph.broken) expect(glyph.broken, name).not.toEqual(glyph.linear);
    }
  });

  it("names every glyph in camel case, the form the brand export turns into kebab case", () => {
    for (const name of NAMES) expect(name).toMatch(/^[a-z][a-zA-Z0-9]*$/);
  });

  it("draws every glyph with absolute path commands inside the 24 × 24 canvas", () => {
    for (const variant of ICON_VARIANTS) {
      for (const name of NAMES) {
        for (const path of iconPaths(name, variant)) {
          // Absolute commands only, so each glyph reads and exports as written.
          expect(path, name).toMatch(/^M[MLHVCSQAZ0-9.\s,-]*$/);
          for (const value of path.match(/-?\d*\.?\d+/g) ?? []) {
            expect(Number(value), `${name}: ${value}`).toBeGreaterThanOrEqual(0);
            expect(Number(value), `${name}: ${value}`).toBeLessThanOrEqual(24);
          }
        }
      }
    }
  });

  it("includes the glyphs Cockpit needs beyond the web client's", () => {
    for (const name of ["refresh", "info", "chart", "pulse", "memory", "database", "clock"]) {
      expect(ICON_GLYPHS, name).toHaveProperty(name);
    }
  });
});
