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

  it("edits the pronouns with the rest of the profile and shows them on the card", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AccountPane {...pane({ onSave })} />);

    const field = screen.getByRole("textbox", { name: /^Zaimki/ });
    expect(field).toHaveValue("on/jego");
    expect(field).toHaveAttribute("maxLength", "32");

    await user.clear(field);
    await user.type(field, "  oni/ich ");
    expect(screen.getByRole("region", { name: "Twoja karta profilu" })).toHaveTextContent("oni/ich");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      displayName: "Patryk",
      pronouns: "oni/ich",
      bio: "",
    });
  });

  it("offers to remove only the pictures that were uploaded", async () => {
    const user = userEvent.setup();
    const onRemoveImage = vi.fn();
    const { rerender } = render(<AccountPane {...pane({ onRemoveImage })} />);

    expect(screen.queryByRole("button", { name: "Usuń awatar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usuń tło" })).toBeNull();

    rerender(<AccountPane {...pane({ onRemoveImage, account: { ...account, avatarUrl: "/assets/a" } })} />);
    expect(screen.queryByRole("button", { name: "Usuń tło" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Usuń awatar" }));

    expect(onRemoveImage).toHaveBeenCalledExactlyOnceWith("avatar");
  });

  it("reports a picture that could not be removed", async () => {
    const user = userEvent.setup();
    render(
      <AccountPane
        {...pane({
          account: { ...account, bannerUrl: "/assets/b" },
          onRemoveImage: vi.fn().mockRejectedValue(new Error("offline")),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Usuń tło" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się usunąć obrazu.");
  });
});
