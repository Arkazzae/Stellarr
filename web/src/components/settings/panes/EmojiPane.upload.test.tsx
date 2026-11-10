import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { EmojiPane, type EmojiPaneProps } from "./EmojiPane";

function props(overrides: Partial<EmojiPaneProps> = {}): EmojiPaneProps {
  return {
    supported: true,
    emoji: [],
    onUpload: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("EmojiPane uploads", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("refuses a file that is not a supported image", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { container } = renderWithConfirm(<EmojiPane {...props()} />);

    await user.upload(fileInput(container), new File(["x"], "notes.txt", { type: "text/plain" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Emoji musi być plikiem JPEG, PNG, GIF lub WebP.",
    );
    expect(screen.queryByRole("textbox", { name: "Nazwa emoji" })).toBeNull();
  });

  it("refuses an image above the size limit", async () => {
    const user = userEvent.setup();
    const { container } = renderWithConfirm(<EmojiPane {...props()} />);
    const huge = new File([new Uint8Array(512 * 1024 + 1)], "huge.png", { type: "image/png" });

    await user.upload(fileInput(container), huge);

    expect(screen.getByRole("alert")).toHaveTextContent("Emoji może mieć najwyżej 256 KB.");
    expect(screen.queryByRole("textbox", { name: "Nazwa emoji" })).toBeNull();
  });

  it("only lets a valid shortcode through and sanitises what is typed", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithConfirm(<EmojiPane {...props({ onUpload })} />);
    const file = new File(["png"], "frog.png", { type: "image/png" });

    await user.upload(fileInput(container), file);
    const name = screen.getByRole("textbox", { name: "Nazwa emoji" });
    await user.clear(name);
    await user.type(name, "A");
    expect(screen.getByRole("button", { name: "Zapisz emoji" })).toBeDisabled();

    await user.type(name, "b-C d");
    expect(name).toHaveValue("abcd");
    await user.type(name, "{Enter}");

    expect(onUpload).toHaveBeenCalledWith("abcd", file);
  });

  it("keeps the editor open and says so when the server refuses the name", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn().mockRejectedValue(new Error("taken"));
    const { container } = renderWithConfirm(<EmojiPane {...props({ onUpload })} />);

    await user.upload(fileInput(container), new File(["png"], "frog.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Zapisz emoji" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się dodać emoji.");
    expect(screen.getByRole("textbox", { name: "Nazwa emoji" })).toHaveValue("frog");
  });

  it("discards the chosen file and its preview on cancel", async () => {
    const user = userEvent.setup();
    const { container } = renderWithConfirm(<EmojiPane {...props()} />);

    await user.upload(fileInput(container), new File(["png"], "frog.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.queryByRole("textbox", { name: "Nazwa emoji" })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});

describe("EmojiPane catalogue", () => {
  it("stops offering uploads once the server holds the maximum", () => {
    const emoji = Array.from({ length: 100 }, (_, index) => ({
      id: `e-${index}`,
      shortcode: `emoji_${index}`,
      glyph: `/api/emoji/e-${index}/image`,
    }));
    renderWithConfirm(<EmojiPane {...props({ emoji })} />);

    expect(screen.getByRole("button", { name: "Dodaj emoji" })).toBeDisabled();
    expect(screen.getByText(/Limit 100 emoji został wykorzystany/)).toBeInTheDocument();
  });

  it("is read-only without permission to manage", () => {
    renderWithConfirm(
      <EmojiPane
        {...props({
          supported: false,
          emoji: [{ id: "e-1", shortcode: "mushris", glyph: "/api/emoji/e-1/image" }],
        })}
      />,
    );

    expect(screen.getByText(":mushris:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usuń emoji/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Dodaj emoji" })).toBeDisabled();
  });

  it("reports a failed removal without hiding the emoji", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("gone"));
    renderWithConfirm(
      <EmojiPane
        {...props({
          onDelete,
          emoji: [{ id: "e-1", shortcode: "mushris", glyph: "/api/emoji/e-1/image" }],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Usuń emoji :mushris:" }));
    await answerConfirm(user, "Usuń");

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się usunąć emoji.");
    expect(screen.getByText(":mushris:")).toBeInTheDocument();
  });
});
