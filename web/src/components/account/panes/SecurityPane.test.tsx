import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Account, EmailChangeResult, PasswordChangeResult } from "@/ports";

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
    onChangeEmail: vi.fn(async (): Promise<EmailChangeResult> => "sent"),
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
  async function askForAddress(user: ReturnType<typeof userEvent.setup>, email: string, password = "haslo1234") {
    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    const field = screen.getByRole("textbox", { name: "Nowy adres e-mail" });
    await user.clear(field);
    await user.type(field, email);
    await user.type(screen.getByLabelText("Obecne hasło"), password);
    await user.click(screen.getByRole("button", { name: "Wyślij link" }));
  }

  it("mails a link to the new address after the password and says where it went", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    expect(screen.getByText("maja@example.com")).toBeVisible();
    await askForAddress(user, "  nowy@example.com ");

    expect(props.onChangeEmail).toHaveBeenCalledExactlyOnceWith("nowy@example.com", "haslo1234");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Wysłaliśmy link na nowy@example.com. Adres zmieni się, gdy go otworzysz.",
    );
    expect(screen.queryByRole("textbox", { name: "Nowy adres e-mail" })).toBeNull();
    // Nothing changes here until the link is opened.
    expect(screen.getByText("maja@example.com")).toBeVisible();
  });

  it("sends nothing without the current password", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: "Zmień e-mail" }));
    const field = screen.getByRole("textbox", { name: "Nowy adres e-mail" });
    await user.clear(field);
    await user.type(field, "nowy@example.com");

    expect(screen.getByRole("button", { name: "Wyślij link" })).toBeDisabled();
    expect(props.onChangeEmail).not.toHaveBeenCalled();
  });

  it("asks for a fresh second step when the server wants one, then sends the link", async () => {
    const user = userEvent.setup();
    const onChangeEmail = vi
      .fn<SecurityPaneProps["onChangeEmail"]>()
      .mockResolvedValueOnce("second-step-required")
      .mockResolvedValueOnce("sent");
    const onConfirmSecondStep = vi.fn(async () => true);
    setup({ onChangeEmail, onConfirmSecondStep });

    await askForAddress(user, "nowy@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent("Wysłaliśmy link na nowy@example.com");
    expect(onConfirmSecondStep).toHaveBeenCalledOnce();
    expect(onChangeEmail).toHaveBeenCalledTimes(2);
  });

  it("says why an address was refused and keeps the editor open", async () => {
    const user = userEvent.setup();
    setup({ onChangeEmail: vi.fn(async (): Promise<EmailChangeResult> => "taken") });

    await askForAddress(user, "zajety@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent("Ten adres należy do innego konta.");
    expect(screen.getByRole("textbox", { name: "Nowy adres e-mail" })).toBeVisible();
  });

  it("cannot be sent a second time while the first request is still pending", async () => {
    const user = userEvent.setup();
    let finish: (result: EmailChangeResult) => void = () => undefined;
    const pending = new Promise<EmailChangeResult>((resolve) => { finish = resolve; });
    const { props } = setup({ onChangeEmail: vi.fn(() => pending) });

    await askForAddress(user, "nowy@example.com");
    expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Zapisywanie…" }));
    expect(props.onChangeEmail).toHaveBeenCalledOnce();

    finish("sent");
    expect(await screen.findByRole("status")).toHaveTextContent("Wysłaliśmy link");
  });

  it("offers to add an address when the account has none", () => {
    setup({ account: { ...account, email: undefined } });

    expect(screen.getByText("Nie ustawiono adresu e-mail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj e-mail" })).toBeEnabled();
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
    expect(screen.getByText("Adresu nie można teraz zmienić.")).toBeInTheDocument();
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

  it("asks for a fresh second step when the server wants one, then changes the password", async () => {
    const user = userEvent.setup();
    const onChangePassword = vi
      .fn<SecurityPaneProps["onChangePassword"]>()
      .mockResolvedValueOnce("second-step-required")
      .mockResolvedValueOnce("changed");
    const onConfirmSecondStep = vi.fn(async () => true);
    setup({ onChangePassword, onConfirmSecondStep });

    await fillPasswords(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Hasło zostało zmienione.");
    expect(onConfirmSecondStep).toHaveBeenCalledOnce();
    expect(onChangePassword).toHaveBeenCalledTimes(2);
  });

  it("keeps the form and says why when the second step is not given", async () => {
    const user = userEvent.setup();
    const onChangePassword = vi.fn(async (): Promise<PasswordChangeResult> => "second-step-required");
    setup({ onChangePassword, onConfirmSecondStep: vi.fn(async () => false) });

    await fillPasswords(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Zmiana hasła wymaga potwierdzenia drugim krokiem.");
    expect(onChangePassword).toHaveBeenCalledOnce();
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
});
