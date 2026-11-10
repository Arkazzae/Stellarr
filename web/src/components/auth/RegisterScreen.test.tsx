import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RegisterScreen } from "./RegisterScreen";

describe("RegisterScreen", () => {
  it("moves through invalid fields in visual order", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(<RegisterScreen onSubmit={onSubmit} />);

    const displayName = screen.getByRole("textbox", { name: "Nazwa widoczna" });
    const username = screen.getByRole("textbox", { name: "Login" });
    const email = screen.getByRole("textbox", { name: "E-mail" });
    const password = screen.getByLabelText("Hasło");
    const confirm = screen.getByLabelText("Powtórz hasło");
    const submit = screen.getByRole("button", { name: "Załóż konto" });

    await user.click(submit);
    expect(displayName).toHaveFocus();
    expect(displayName).toHaveAttribute("aria-invalid", "true");

    await user.type(displayName, "Maja");
    await user.click(submit);
    expect(username).toHaveFocus();

    await user.type(username, "maja");
    await user.click(submit);
    expect(email).toHaveFocus();

    await user.type(email, "maja@example.com");
    await user.click(submit);
    expect(password).toHaveFocus();

    await user.type(password, "haslo123");
    await user.click(submit);
    expect(confirm).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(confirm, "haslo123");
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({
      displayName: "Maja",
      username: "maja",
      email: "maja@example.com",
      password: "haslo123",
    });
  });
});
