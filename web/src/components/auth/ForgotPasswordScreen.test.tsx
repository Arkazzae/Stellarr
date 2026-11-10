import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ForgotPasswordScreen } from "./ForgotPasswordScreen";

describe("ForgotPasswordScreen", () => {
  it("keeps the submit button off until an address is typed", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordScreen onSubmit={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "Wyślij link do zmiany hasła" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "E-mail" }), "maja@example.com");
    expect(submit).toBeEnabled();
  });

  it("sends the trimmed address and then confirms without echoing the form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<ForgotPasswordScreen onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox", { name: "E-mail" }), " maja@example.com ");
    await user.click(screen.getByRole("button", { name: "Wyślij link do zmiany hasła" }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("maja@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent("Sprawdź skrzynkę pocztową.");
    expect(screen.queryByRole("textbox", { name: "E-mail" })).not.toBeInTheDocument();
  });

  it("says the request failed and keeps the form so it can be retried", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<ForgotPasswordScreen onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox", { name: "E-mail" }), "maja@example.com");
    await user.click(screen.getByRole("button", { name: "Wyślij link do zmiany hasła" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wysłać prośby.");
    expect(screen.getByRole("textbox", { name: "E-mail" })).toBeEnabled();
  });
});
