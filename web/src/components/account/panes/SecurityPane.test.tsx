import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Account, PasswordChangeResult } from "@/ports";

import { SecurityPane, type SecurityPaneProps } from "./SecurityPane";

const account: Account = {
  id: "u-maja-9",
  username: "maja",
  displayName: "Maja",
  email: "maja@example.com",
  createdAt: new Date(0).toISOString(),
  customStatus: "",
  bio: "",
  pronouns: "",
};

function setup(overrides: Partial<SecurityPaneProps> = {}) {
  const props: SecurityPaneProps = {
    account,
    emailSupported: true,
    passwordSupported: true,
    onChangeEmail: vi.fn(),
    onChangePassword: vi.fn(async (): Promise<PasswordChangeResult> => "changed"),
    ...overrides,
  };
  const view = render(<SecurityPane {...props} />);
  return { props, ...view };
}

async function fillPasswords(
  user: ReturnType<typeof userEvent.setup>,
  { current = "staraaaa1", next = "nowehaslo1", confirm }: {
    current?: string;
    next?: string;
    confirm?: string;
  } = {},
) {
  await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
  await user.type(screen.getByLabelText(/Obecne hasło/), current);
  await user.type(screen.getByLabelText(/^Nowe hasło/), next);
  await user.type(screen.getByLabelText(/Powtórz nowe hasło/), confirm ?? next);
}

describe("SecurityPane e-mail", () => {
  it("shows the saved address and saves a new one apart from the profile", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    expect(screen.getByText("maja@example.com")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    const field = screen.getByRole("textbox", { name: "Nowy adres e-mail" });
    expect(screen.getByRole("button", { name: "Zapisz e-mail" })).toBeDisabled();

    await user.clear(field);
    await user.type(field, "  nowy@example.com ");
    await user.click(screen.getByRole("button", { name: "Zapisz e-mail" }));

    expect(props.onChangeEmail).toHaveBeenCalledExactlyOnceWith("nowy@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent("Adres e-mail został zmieniony.");
    expect(screen.queryByRole("textbox", { name: "Nowy adres e-mail" })).toBeNull();
  });

  it("cannot be sent a second time while the first save is still pending", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const { props } = setup({ onChangeEmail: vi.fn(() => pending) });

    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    const field = screen.getByRole("textbox", { name: "Nowy adres e-mail" });
    await user.clear(field);
    await user.type(field, "nowy@example.com");
    await user.click(screen.getByRole("button", { name: "Zapisz e-mail" }));
    expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();

    await user.type(field, "x");
    expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();
    expect(props.onChangeEmail).toHaveBeenCalledOnce();

    finish();
    expect(await screen.findByRole("status")).toHaveTextContent("Adres e-mail został zmieniony.");
  });

  it("offers to add an address when the account has none", () => {
    setup({ account: { ...account, email: undefined } });

    expect(screen.getByText("Nie ustawiono adresu e-mail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj e-mail" })).toBeEnabled();
  });

  it("reports a refused address and keeps the editor open", async () => {
    const user = userEvent.setup();
    setup({ onChangeEmail: vi.fn(async () => { throw new Error("taken"); }) });

    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    const field = screen.getByRole("textbox", { name: "Nowy adres e-mail" });
    await user.clear(field);
    await user.type(field, "zajety@example.com");
    await user.click(screen.getByRole("button", { name: "Zapisz e-mail" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zmienić adresu e-mail");
    expect(screen.getByRole("textbox", { name: "Nowy adres e-mail" })).toBeVisible();
  });

  it("drops a draft when the address is replaced from elsewhere", async () => {
    const user = userEvent.setup();
    const { props, rerender } = setup();

    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    await user.type(screen.getByRole("textbox", { name: "Nowy adres e-mail" }), "x");

    rerender(<SecurityPane {...props} account={{ ...account, email: "inny@example.com" }} />);

    expect(screen.getByText("inny@example.com")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Nowy adres e-mail" })).toBeNull();
  });

  it("hides the editor and says why when the server cannot change addresses", () => {
    setup({ emailSupported: false });

    expect(screen.queryByRole("button", { name: "Zmień e-mail" })).toBeNull();
    expect(screen.getByText(/zmiana adresu/i)).toBeInTheDocument();
  });
});

describe("SecurityPane password", () => {
  it("will not change a password until both new fields agree", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await fillPasswords(user, { confirm: "nowehaslo2" });

    expect(screen.getByRole("button", { name: "Zmień hasło" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Hasła się nie zgadzają");
    expect(props.onChangePassword).not.toHaveBeenCalled();
  });

  it("needs a new password of at least eight characters", async () => {
    const user = userEvent.setup();
    setup();

    await fillPasswords(user, { next: "krotkie" });

    expect(screen.getByRole("button", { name: "Zmień hasło" })).toBeDisabled();
  });

  it("sends both passwords and closes the form once it is accepted", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await fillPasswords(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));

    expect(props.onChangePassword).toHaveBeenCalledExactlyOnceWith("staraaaa1", "nowehaslo1");
    expect(await screen.findByRole("status")).toHaveTextContent("Hasło zostało zmienione.");
    expect(screen.queryByLabelText(/Obecne hasło/)).toBeNull();
  });

  it("keeps the form open and says what was wrong with the current password", async () => {
    const user = userEvent.setup();
    setup({ onChangePassword: vi.fn(async (): Promise<PasswordChangeResult> => "wrong-current") });

    await fillPasswords(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Obecne hasło się nie zgadza.");
    expect(screen.getByLabelText(/Obecne hasło/)).toHaveValue("staraaaa1");
  });

  it("reports a request that failed outright", async () => {
    const user = userEvent.setup();
    setup({ onChangePassword: vi.fn(async () => { throw new Error("down"); }) });

    await fillPasswords(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zmienić hasła.");
  });

  it("forgets what was typed when the form is cancelled", async () => {
    const user = userEvent.setup();
    setup();

    await fillPasswords(user);
    await user.click(screen.getByRole("button", { name: "Anuluj zmianę hasła" }));
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));

    expect(screen.getByLabelText(/Obecne hasło/)).toHaveValue("");
  });

  it("cannot be opened when the server has no password change", () => {
    setup({ passwordSupported: false });

    expect(screen.getByRole("button", { name: "Zmień hasło" })).toBeDisabled();
  });
});
