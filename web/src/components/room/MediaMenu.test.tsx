import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMediaMenu, type MediaMenuTarget } from "./MediaMenu";

function Host({ target }: { target: MediaMenuTarget }) {
  const menu = useMediaMenu();
  return (
    <>
      <div data-testid="media" onContextMenu={menu.onContextMenu(target)} />
      {menu.node}
    </>
  );
}

function raiseMenu(target: MediaMenuTarget, init: MouseEventInit = {}) {
  render(<Host target={target} />);
  const raised = fireEvent.contextMenu(screen.getByTestId("media"), {
    clientX: 30,
    clientY: 40,
    ...init,
  });
  return { prevented: !raised };
}

function itemNames(): string[] {
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

const IMAGE: MediaMenuTarget = { kind: "image", src: "/files/kot.png" };
const VIDEO: MediaMenuTarget = { kind: "video", src: "/files/pies.webm" };

function stubClipboard(images: boolean) {
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText, write: images ? vi.fn() : undefined },
    configurable: true,
  });
  vi.stubGlobal("ClipboardItem", images ? class {} : undefined);
  return writeText;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useMediaMenu", () => {
  it("offers to copy, save and open a picture", () => {
    stubClipboard(true);
    raiseMenu(IMAGE);

    expect(screen.getByRole("menu", { name: "Obraz" })).toBeInTheDocument();
    expect(itemNames()).toEqual([
      "Kopiuj obraz",
      "Kopiuj adres obrazu",
      "Zapisz obraz",
      "Otwórz w nowej karcie",
    ]);
  });

  it("leaves out copying the picture where the clipboard takes no bitmaps", () => {
    stubClipboard(false);
    raiseMenu(IMAGE);

    expect(itemNames()).toEqual([
      "Kopiuj adres obrazu",
      "Zapisz obraz",
      "Otwórz w nowej karcie",
    ]);
  });

  it("offers a clip only its address, a file to save and a new tab", () => {
    stubClipboard(true);
    raiseMenu(VIDEO);

    expect(screen.getByRole("menu", { name: "Nagranie" })).toBeInTheDocument();
    expect(itemNames()).toEqual(["Kopiuj adres", "Zapisz plik", "Otwórz w nowej karcie"]);
  });

  it("copies the full address and closes", () => {
    const writeText = stubClipboard(true);
    raiseMenu(IMAGE);

    fireEvent.click(screen.getByRole("menuitem", { name: "Kopiuj adres obrazu" }));

    expect(writeText).toHaveBeenCalledWith(new URL("/files/kot.png", window.location.href).toString());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the media in a new tab without handing over the opener", () => {
    stubClipboard(true);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    raiseMenu(VIDEO);

    fireEvent.click(screen.getByRole("menuitem", { name: "Otwórz w nowej karcie" }));

    expect(open).toHaveBeenCalledWith("/files/pies.webm", "_blank", "noopener");
  });

  it.each([
    ["a picture under the name it was given", { ...IMAGE, name: "Mój kot.png" }, "Zapisz obraz", "Mój kot.png"],
    ["a picture under the name in its address", IMAGE, "Zapisz obraz", "kot.png"],
    ["a clip under the name it was given", { ...VIDEO, name: "pies.mp4" }, "Zapisz plik", "pies.mp4"],
    ["a clip under the name in its address", VIDEO, "Zapisz plik", "pies.webm"],
  ] as const)("saves %s", async (_case, target, item, filename) => {
    stubClipboard(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"]))));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:saved");
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    raiseMenu(target);

    fireEvent.click(screen.getByRole("menuitem", { name: item }));

    await waitFor(() => expect(downloads).toEqual([filename]));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves Shift+right-click to the browser", () => {
    stubClipboard(true);
    const { prevented } = raiseMenu(IMAGE, { shiftKey: true });

    expect(prevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("takes the right-click for itself otherwise", () => {
    stubClipboard(true);
    const { prevented } = raiseMenu(IMAGE);

    expect(prevented).toBe(true);
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").length).toBeGreaterThan(0);
  });
});
