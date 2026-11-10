import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChannelCreate } from "./ChannelCreate";

describe("ChannelCreate", () => {
  it("waits for persistence before closing and prevents duplicate submissions", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onCreate = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const onClose = vi.fn();
    render(
      <ChannelCreate
        open
        kind="text"
        supported
        sections={[]}
        onCreate={onCreate}
        onClose={onClose}
      />,
    );

    expect(screen.queryByRole("combobox", { name: /Sekcja/ })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: /Nazwa/ }), "Nowy Kanał");
    await user.click(screen.getByRole("button", { name: "Dodaj kanał" }));

    expect(onCreate).toHaveBeenCalledWith({ name: "nowy-kanał", kind: "text" });
    expect(screen.getByRole("button", { name: "Tworzenie…" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Tworzenie…" }));
    expect(onCreate).toHaveBeenCalledOnce();

    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("keeps the form open and explains a duplicate name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(
      new Error("Kanał o tej nazwie już istnieje."),
    );
    const onClose = vi.fn();
    render(
      <ChannelCreate
        open
        kind="voice"
        supported
        sections={[]}
        onCreate={onCreate}
        onClose={onClose}
      />,
    );

    const name = screen.getByRole("textbox", { name: /Nazwa/ });
    await user.type(name, "Salon");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kanał o tej nazwie już istnieje.",
    );
    expect(name).toHaveValue("Salon");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers an optional section and includes it in the created channel", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve());
    render(
      <ChannelCreate
        open
        kind="text"
        supported
        sections={[{ id: "sec-1", name: "Ogłoszenia" }]}
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: /Nazwa/ }), "Ważne");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Sekcja/ }),
      "Ogłoszenia",
    );
    await user.click(screen.getByRole("button", { name: "Dodaj kanał" }));

    expect(onCreate).toHaveBeenCalledWith({ name: "ważne", kind: "text", sectionId: "sec-1" });
  });
});
