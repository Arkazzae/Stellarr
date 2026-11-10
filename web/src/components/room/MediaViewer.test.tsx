import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MediaViewer, type ViewerTarget } from "./MediaViewer";

const gallery: ViewerTarget = {
  kind: "image",
  index: 1,
  images: [
    { src: "/one.png", alt: "Pierwszy obraz" },
    { src: "/two.png", alt: "Drugi obraz" },
    { src: "/three.png", alt: "Trzeci obraz" },
  ],
};

function swipe(
  image: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType = "touch",
) {
  fireEvent.pointerDown(image, {
    pointerId: 7,
    pointerType,
    isPrimary: true,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(image, {
    pointerId: 7,
    pointerType,
    isPrimary: true,
    clientX: to.x,
    clientY: to.y,
  });
  fireEvent.pointerUp(image, {
    pointerId: 7,
    pointerType,
    isPrimary: true,
    clientX: to.x,
    clientY: to.y,
  });
}

describe("MediaViewer", () => {
  it("moves through an image gallery with a deliberate horizontal touch swipe", () => {
    render(<MediaViewer target={gallery} onClose={vi.fn()} />);

    const second = screen.getByRole("img", { name: "Drugi obraz" });
    expect(screen.getByText("2 / 3")).toHaveAttribute("aria-live", "polite");

    fireEvent.pointerDown(second, {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: 260,
      clientY: 140,
    });
    fireEvent.pointerMove(second, {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: 180,
      clientY: 144,
    });

    expect(second).toHaveAttribute("data-dragging");
    expect(second.style.getPropertyValue("--mv-drag-x")).toBe("-80px");

    fireEvent.pointerUp(second, {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: 180,
      clientY: 144,
    });

    expect(screen.getByRole("img", { name: "Trzeci obraz" })).toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("ignores vertical and mouse drags while preserving buttons and keyboard", async () => {
    const user = userEvent.setup();
    render(<MediaViewer target={gallery} onClose={vi.fn()} />);

    let image = screen.getByRole("img", { name: "Drugi obraz" });
    swipe(image, { x: 180, y: 80 }, { x: 170, y: 160 });
    expect(screen.getByRole("img", { name: "Drugi obraz" })).toBeInTheDocument();

    image = screen.getByRole("img", { name: "Drugi obraz" });
    swipe(image, { x: 250, y: 120 }, { x: 120, y: 120 }, "mouse");
    expect(screen.getByRole("img", { name: "Drugi obraz" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Następne" }));
    expect(screen.getByRole("img", { name: "Trzeci obraz" })).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("img", { name: "Pierwszy obraz" })).toBeInTheDocument();
  });
});
