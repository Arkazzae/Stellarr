import { existsSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon, type IconName } from "./Icon";
import { NOISE_IMAGES } from "./noiseImages";
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
      }
    }
  });

  it("uses a heavier or lighter stroke only where the table asks for one", () => {
    const widths = (name: IconName) =>
      Array.from(renderIcon(name).querySelectorAll("path"), (path) =>
        path.getAttribute("stroke-width"),
      );

    expect(widths("hash")).toEqual(["1.5", "1.5", "1.5", "1.5"]);
    expect(widths("pin")).toEqual(["2", "2", "2"]);
    expect(widths("cinemaOff")).toEqual(["1", "1", "1", "1"]);
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

  it("masks the noise-suppression images with the current colour", () => {
    const node = renderIcon("noiseRnnoise", { size: 20, className: "extra" });

    expect(node.tagName).toBe("SPAN");
    expect(node).toHaveClass("icon-image", "extra");
    expect(node.style.width).toBe("20px");
    expect(node.style.backgroundColor).toBe("currentcolor");
    expect(node.getAttribute("style")).toContain(NOISE_IMAGES.noiseRnnoise);
  });

  it("points every noise image at a file the app serves", () => {
    for (const url of Object.values(NOISE_IMAGES)) {
      expect(existsSync(join(process.cwd(), "public", url)), url).toBe(true);
    }
  });
});
