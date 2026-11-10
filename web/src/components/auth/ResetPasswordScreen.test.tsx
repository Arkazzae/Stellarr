import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ResetPasswordScreen } from "./ResetPasswordScreen";

const newPassword = () => screen.getByLabelText("Nowe hasło");
const confirmation = () => screen.getByLabelText("Powtórz nowe hasło");
const submit = () => screen.getByRole("button", { name: "Ustaw nowe hasło" });

describe("ResetPasswordScreen", () => {
  it("refuses a password under 8 characters before calling onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<ResetPasswordScreen token="abc" onSubmit={onSubmit} />);

    await user.type(newPassword(), "short");
    await user.type(confirmation(), "short");
    await user.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Hasło musi mieć co najmniej 8 znaków.");
  });

  it("refuses two fields that disagree before calling onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<ResetPasswordScreen token="abc" onSubmit={onSubmit} />);

    await user.type(newPassword(), "haslo1234");
    await user.type(confirmation(), "haslo4321");

    expect(confirmation()).toHaveAttribute("aria-invalid", "true");
    await user.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Hasła nie są takie same.");
  });

  it("sends the token with the new password and then points to the login", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<ResetPasswordScreen token="abc" onSubmit={onSubmit} />);

    await user.type(newPassword(), "haslo1234");
    await user.type(confirmation(), "haslo1234");
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("abc", "haslo1234");
    expect(await screen.findByRole("status")).toHaveTextContent("Hasło zostało zmienione.");
    expect(screen.getByRole("link", { name: "Przejdź do logowania" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("explains that the link is no longer valid when the request is rejected", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new Error("expired");
    });
    render(<ResetPasswordScreen token="abc" onSubmit={onSubmit} />);

    await user.type(newPassword(), "haslo1234");
    await user.type(confirmation(), "haslo1234");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Link jest nieprawidłowy");
    expect(newPassword()).toBeEnabled();
  });

  it("offers a new link instead of a form when the address has no token", () => {
    render(<ResetPasswordScreen token="" onSubmit={vi.fn()} />);

    expect(screen.queryByLabelText("Nowe hasło")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wyślij nowy link" })).toHaveAttribute(
      "href",
      "/zapomniane-haslo",
    );
  });
});
