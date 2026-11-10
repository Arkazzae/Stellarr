import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { EmojiPane } from "./EmojiPane";

describe("EmojiPane", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("names and uploads a selected image", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithConfirm(
      <EmojiPane supported emoji={[]} onUpload={onUpload} onDelete={vi.fn()} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["png"], "Party Frog.png", { type: "image/png" });

    await user.upload(input, file);
    expect(screen.getByRole("textbox", { name: "Nazwa emoji" })).toHaveValue(
      "party_frog",
    );
    await user.click(screen.getByRole("button", { name: "Zapisz emoji" }));

    expect(onUpload).toHaveBeenCalledWith("party_frog", file);
    expect(screen.queryByRole("textbox", { name: "Nazwa emoji" })).toBeNull();
  });

  it("shows the app-standard empty state and capacity", () => {
    renderWithConfirm(
      <EmojiPane supported emoji={[]} onUpload={vi.fn()} onDelete={vi.fn()} />,
    );

    expect(screen.getByText("Jeszcze nie ma własnych emoji")).toBeInTheDocument();
    expect(screen.getByLabelText("0 z 100 emoji")).toHaveTextContent("0/100");
    expect(screen.getByRole("button", { name: "Dodaj emoji" })).toBeEnabled();
  });

  it("removes an uploaded emoji after confirmation", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderWithConfirm(
      <EmojiPane
        supported
        emoji={[
          { id: "e-1", shortcode: ":mushris:", glyph: "/api/emoji/e-1/image" },
        ]}
        onUpload={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Usuń emoji :mushris:" }));
    expect(onDelete).not.toHaveBeenCalled();

    await answerConfirm(user, "Usuń");
    expect(onDelete).toHaveBeenCalledWith("e-1");
  });
});
