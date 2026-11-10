import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DropOverlay } from "./DropOverlay";

function renderOverlay(
  props: Partial<React.ComponentProps<typeof DropOverlay>> = {},
) {
  const onDropFiles = vi.fn();
  render(
    <DropOverlay channelName="ogólny" onDropFiles={onDropFiles} {...props} />,
  );
  return onDropFiles;
}

/** A drag carrying one file, the way the file manager delivers one. */
function fileDrag(file: File) {
  return {
    dataTransfer: { types: ["Files"], files: [file] },
  };
}

describe("DropOverlay", () => {
  it("attaches a file dragged in from outside the app", () => {
    const onDropFiles = renderOverlay();
    const photo = new File(["png"], "kot.png", { type: "image/png" });

    fireEvent.dragEnter(window, fileDrag(photo));
    expect(document.querySelector(".drop-overlay.show")).not.toBeNull();

    fireEvent.drop(window, fileDrag(photo));
    expect(onDropFiles).toHaveBeenCalledWith([photo]);
  });

  it("ignores a drag that started inside the app", () => {
    const onDropFiles = renderOverlay();
    // Chromium describes a dragged page image as a file, which is how an
    // avatar pulled across the window used to become an upload.
    const avatar = new File(["png"], "avatar.png", { type: "image/png" });

    fireEvent.dragStart(screen.getByText("ogólny", { exact: false }));
    fireEvent.dragEnter(window, fileDrag(avatar));
    expect(document.querySelector(".drop-overlay.show")).toBeNull();

    fireEvent.drop(window, fileDrag(avatar));
    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it("is disarmed while the room is showing something else", () => {
    const onDropFiles = renderOverlay({ enabled: false });
    const photo = new File(["png"], "kot.png", { type: "image/png" });

    fireEvent.dragEnter(window, fileDrag(photo));
    fireEvent.drop(window, fileDrag(photo));

    expect(document.querySelector(".drop-overlay.show")).toBeNull();
    expect(onDropFiles).not.toHaveBeenCalled();
  });
});
