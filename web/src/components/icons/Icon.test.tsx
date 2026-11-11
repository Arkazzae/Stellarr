import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon, type IconName } from "./Icon";
import { ICON_PATHS } from "./paths";

function renderIcon(name: IconName, props: { size?: number; className?: string } = {}) {
  const { container } = render(<Icon name={name} {...props} />);
  return container.firstElementChild as HTMLElement | SVGElement;
}

describe("Icon", () => {
  it("draws every glyph of the table as a stroked path", () => {
    for (const name of Object.keys(ICON_PATHS) as (keyof typeof ICON_PATHS)[]) {
      const svg = renderIcon(name);
      const paths = svg.querySelectorAll("path");

      expect(paths, name).toHaveLength(ICON_PATHS[name].length);
      for (const path of paths) {
        expect(path.getAttribute("d"), name).toBeTruthy();
        expect(path.getAttribute("stroke")).toBe("currentColor");
        expect(path.getAttribute("stroke-width")).toBe("1.5");
        expect(path.getAttribute("stroke-linecap")).toBe("round");
        expect(path.getAttribute("stroke-linejoin")).toBe("round");
      }
    }
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
});
