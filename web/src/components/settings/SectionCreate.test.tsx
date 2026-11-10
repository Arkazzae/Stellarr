import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SectionCreate } from "./SectionCreate";

const nameField = () => screen.getByRole("textbox", { name: /Nazwa sekcji/ });
const submitButton = () => screen.getByRole("button", { name: "Dodaj sekcję" });

describe("SectionCreate", () => {
  it("cannot be submitted until the name has something other than spaces", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve());
    render(<SectionCreate open onClose={vi.fn()} onCreate={onCreate} />);

    expect(submitButton()).toBeDisabled();
    await user.type(nameField(), "   ");
    expect(submitButton()).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(onCreate).not.toHaveBeenCalled();

    await user.type(nameField(), "Ogłoszenia");
    expect(submitButton()).toBeEnabled();
  });

  it("creates the section under its trimmed name and then closes", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(<SectionCreate open onClose={onClose} onCreate={onCreate} />);

    await user.type(nameField(), "  Ogłoszenia  ");
    await user.click(submitButton());

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: "Ogłoszenia" });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("stays open while saving and ignores a second submit", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onCreate = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const onClose = vi.fn();
    render(<SectionCreate open onClose={onClose} onCreate={onCreate} />);

    await user.type(nameField(), "Gry");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Tworzenie…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zamknij" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("shows the reason a section could not be created and keeps the name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error("Sekcja o tej nazwie już istnieje."));
    const onClose = vi.fn();
    render(<SectionCreate open onClose={onClose} onCreate={onCreate} />);

    await user.type(nameField(), "Gry");
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Sekcja o tej nazwie już istnieje.");
    expect(nameField()).toHaveValue("Gry");
    expect(nameField()).toBeInvalid();
    expect(onClose).not.toHaveBeenCalled();

    await user.type(nameField(), "!");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to a generic message when the failure carries none", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue("boom");
    render(<SectionCreate open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(nameField(), "Gry");
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się utworzyć sekcji.");
  });

  it("closes from the cancel button and reopens with an empty name", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <SectionCreate open onClose={onClose} onCreate={vi.fn(() => Promise.resolve())} />,
    );

    await user.type(nameField(), "Gry");
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <SectionCreate open={false} onClose={onClose} onCreate={vi.fn(() => Promise.resolve())} />,
    );
    rerender(
      <SectionCreate open onClose={onClose} onCreate={vi.fn(() => Promise.resolve())} />,
    );
    expect(nameField()).toHaveValue("");
  });
});
