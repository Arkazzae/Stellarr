import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Account } from "@/ports";

import { AccountPane, type AccountPaneProps } from "./AccountPane";

const account: Account = {
  id: "account-test-user",
  username: "patryk",
  displayName: "Patryk",
  createdAt: "2026-08-30T12:00:00.000Z",
  customStatus: "",
  bio: "",
  pronouns: "on/jego",
};

function pane(overrides: Partial<AccountPaneProps> = {}): AccountPaneProps {
  return {
    account,
    onSave: vi.fn(),
    onPickImage: vi.fn(),
    onRemoveImage: vi.fn(),
    ...overrides,
  };
}

function bioField(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: /^O mnie/ }) as HTMLTextAreaElement;
}

describe("AccountPane", () => {
  it("shows an unsaved bio on the card before it is saved", async () => {
    const user = userEvent.setup();
    render(<AccountPane {...pane()} />);

    const card = screen.getByRole("region", { name: "Twoja karta profilu" });
    expect(card).not.toHaveTextContent("Cześć");

    await user.type(bioField(), "Cześć");

    expect(card).toHaveTextContent("Cześć");
  });

  it("wraps a selected address in a link and leaves the address selected", async () => {
    const user = userEvent.setup();
    render(<AccountPane {...pane({ account: { ...account, bio: "see https://example.com" } })} />);

    bioField().setSelectionRange(4, 23);
    await user.click(screen.getByRole("button", { name: "Dodaj link" }));

    expect(bioField()).toHaveValue("see [link](https://example.com)");
    await vi.waitFor(() => {
      expect(bioField().selectionStart).toBe(11);
      expect(bioField().selectionEnd).toBe(30);
    });
  });

  it("does not format past the length the profile can store", async () => {
    const user = userEvent.setup();
    const full = "a".repeat(2000);
    render(<AccountPane {...pane({ account: { ...account, bio: full } })} />);

    await user.click(screen.getByRole("button", { name: "Pogrubienie" }));

    expect(bioField()).toHaveValue(full);
    expect(screen.getByText("2000/2000")).toBeInTheDocument();
  });

  it("reports a rejected save and lets the person try again", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<AccountPane {...pane({ onSave })} />);

    await user.type(screen.getByLabelText(/Nazwa wyświetlana/), "!");
    const save = screen.getByRole("button", { name: "Zapisz zmiany" });
    await user.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się zapisać profilu",
    );
    expect(save).toBeEnabled();

    await user.click(save);

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Zapisano" })).toBeInTheDocument();
  });

  it("takes the fields from the account again when it changes underneath", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AccountPane {...pane()} />);
    await user.type(screen.getByLabelText(/Nazwa wyświetlana/), "!");

    rerender(
      <AccountPane
        {...pane({ account: { ...account, displayName: "Patryk K.", bio: "Cześć" } })}
      />,
    );

    expect(screen.getByLabelText(/Nazwa wyświetlana/)).toHaveValue("Patryk K.");
    expect(bioField()).toHaveValue("Cześć");
    expect(screen.getByRole("button", { name: "Zapisz zmiany" })).toBeDisabled();
  });

  it("reports a picture that could not be uploaded", async () => {
    const user = userEvent.setup();
    const onPickImage = vi.fn().mockRejectedValue(new Error("too large"));
    render(<AccountPane {...pane({ onPickImage })} />);
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="image/png"]',
    );
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    await user.upload(input!, file);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się przesłać obrazu",
    );
    expect(onPickImage).toHaveBeenCalledWith("avatar", file);
  });
});
