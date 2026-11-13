import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MediaViewer, type ViewerTarget } from "./MediaViewer";

const single: ViewerTarget = {
  kind: "image",
  index: 0,
  images: [{ src: "/files/kot.png", alt: "Kot" }],
};

function stage(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".mv-stage");
  if (element === null) throw new Error("The viewer is not open");
  return element;
}

describe("MediaViewer", () => {
  it("renders nothing while there is no target", () => {
    render(<MediaViewer target={null} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a lone image without gallery controls", () => {
    render(<MediaViewer target={single} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Kot" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Następne" })).toBeNull();
    expect(screen.queryByText(/ \/ /)).toBeNull();
  });

  it("starts the next gallery at its own position", () => {
    const gallery = (index: number): ViewerTarget => ({
      kind: "image",
      index,
      images: [
        { src: "/1.png", alt: "Jeden" },
        { src: "/2.png", alt: "Dwa" },
        { src: "/3.png", alt: "Trzy" },
      ],
    });
    const { rerender } = render(<MediaViewer target={gallery(0)} onClose={vi.fn()} />);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByRole("img", { name: "Trzy" })).toBeInTheDocument();

    rerender(<MediaViewer target={gallery(1)} onClose={vi.fn()} />);

    expect(screen.getByRole("img", { name: "Dwa" })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("closes from the close button, Escape and the empty space around the media", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MediaViewer target={single} onClose={onClose} />);

    await user.click(screen.getByRole("img", { name: "Kot" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(stage());
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("offers the picture's menu from the space around it", () => {
    render(<MediaViewer target={single} onClose={vi.fn()} />);

    fireEvent.contextMenu(stage(), { clientX: 5, clientY: 5 });

    expect(screen.getByRole("menu", { name: "Obraz" })).toBeInTheDocument();
  });

  it("links the download to the image on screen", () => {
    render(<MediaViewer target={single} onClose={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Pobierz" })).toHaveAttribute(
      "href",
      "/files/kot.png",
    );
  });

  it("plays a video and names the dialog after it", () => {
    render(
      <MediaViewer
        target={{ kind: "video", src: "/files/pies.webm", name: "Pies.webm" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Pies.webm" })).toBeInTheDocument();
    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "/files/pies.webm");
    // Playback opens with its sound; only the in-message frame is a still.
    expect(video).toHaveProperty("muted", false);
    expect(screen.getByRole("link", { name: "Pobierz" })).toHaveAttribute(
      "href",
      "/files/pies.webm",
    );
  });

  it("falls back to the poster when the video will not play", () => {
    render(
      <MediaViewer
        target={{ kind: "video", src: "/files/pies.webm", poster: "/files/pies.jpg" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.error(document.querySelector("video")!);

    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByText(/Nagranie nie jest dostępne/)).toBeInTheDocument();
    expect(document.querySelector('img[src="/files/pies.jpg"]')).not.toBeNull();
  });

  it("still offers the download link and the menu when the upload carries no file", () => {
    render(<MediaViewer target={{ kind: "video", src: "" }} onClose={vi.fn()} />);

    expect(screen.getByText(/Nagranie nie jest dostępne/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Wideo" })).toBeInTheDocument();
    // An anchor with an empty address is not exposed as a link, so find it by label.
    expect(screen.getByLabelText("Pobierz")).toHaveAttribute("href", "");

    fireEvent.contextMenu(stage());
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("keeps an empty name or description as the title instead of a generic one", () => {
    const { rerender } = render(
      <MediaViewer
        target={{ kind: "image", index: 0, images: [{ src: "/a.png", alt: "" }] }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toBeEmptyDOMElement();

    rerender(
      <MediaViewer target={{ kind: "video", src: "/a.webm", name: "" }} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toBeEmptyDOMElement();
  });

  it("shows the first image when the index is outside the gallery", () => {
    render(
      <MediaViewer
        target={{
          kind: "image",
          index: 5,
          images: [
            { src: "/1.png", alt: "Jeden" },
            { src: "/2.png", alt: "Dwa" },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "Jeden" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Obraz");

    fireEvent.contextMenu(screen.getByRole("img", { name: "Jeden" }));
    expect(screen.getByRole("menu", { name: "Obraz" })).toBeInTheDocument();
  });
});
