import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginScreen } from "./LoginScreen";

const identifier = () => screen.getByRole("textbox", { name: "Login lub e-mail" });
const password = () => screen.getByLabelText("Hasło");
const submit = () => screen.getByRole("button", { name: "Zaloguj się" });

describe("LoginScreen", () => {
  it("submits the entered credentials with the login trimmed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} />);

    await user.type(identifier(), "  maja  ");
    await user.type(password(), "haslo123");
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("maja", "haslo123");
  });

  it("asks for both fields before submitting anything", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} />);

    await user.type(identifier(), "maja");
    await user.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Podaj login lub e-mail oraz hasło.");
    expect(identifier()).toHaveFocus();
    expect(identifier()).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the local complaint once the form is complete", async () => {
    const user = userEvent.setup();
    render(<LoginScreen onSubmit={vi.fn()} />);

    await user.click(submit());
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(identifier(), "maja");
    await user.type(password(), "haslo123");
    await user.click(submit());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error it is given and moves focus to the login", () => {
    render(<LoginScreen onSubmit={vi.fn()} error="Nieprawidłowy login lub hasło." />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Nieprawidłowy login lub hasło.");
    expect(password()).toHaveAttribute("aria-describedby", alert.id);
    expect(identifier()).toHaveFocus();
  });

  it("locks the form and ignores a submit while a request is pending", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} pending />);

    expect(identifier()).toBeDisabled();
    expect(password()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Logowanie…" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers no form while the existing session is being checked", () => {
    render(<LoginScreen onSubmit={vi.fn()} checking />);

    expect(screen.getByText("Sprawdzanie sesji…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hasło")).not.toBeInTheDocument();
  });

  it("links the external sign-in and says it is an alternative to the password", () => {
    render(
      <LoginScreen
        onSubmit={vi.fn()}
        externalLogin={{ href: "/api/auth/oidc/login?returnUrl=%2F", label: "Zaloguj przez Keycloak" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Zaloguj przez Keycloak" })).toHaveAttribute(
      "href",
      "/api/auth/oidc/login?returnUrl=%2F",
    );
    expect(screen.getByText("albo użyj hasła")).toBeInTheDocument();
  });

  it("runs the external sign-in handler instead of following a link when one is given", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <LoginScreen onSubmit={vi.fn()} externalLogin={{ label: "Zaloguj przez Keycloak", onClick }} />,
    );

    await user.click(screen.getByRole("button", { name: "Zaloguj przez Keycloak" }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <LoginScreen
        onSubmit={vi.fn()}
        externalLogin={{ label: "Zaloguj przez Keycloak", onClick, pending: true }}
      />,
    );
    expect(screen.getByRole("button", { name: "Zaloguj przez Keycloak" })).toBeDisabled();
  });

  it("shows why the external sign-in failed", () => {
    render(<LoginScreen onSubmit={vi.fn()} externalError="Logowanie przez konto główne nie powiodło się." />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Logowanie przez konto główne nie powiodło się.",
    );
  });

  it("hides the password from the browser's credential UI when a native broker owns it", () => {
    render(<LoginScreen onSubmit={vi.fn()} nativeCredentialBroker />);

    const field = password();
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("data-1p-ignore", "true");
  });

  it("passes the requested password autocomplete mode through", () => {
    render(<LoginScreen onSubmit={vi.fn()} passwordAutoComplete="new-password" />);

    expect(password()).toHaveAttribute("autocomplete", "new-password");
  });

  it("places a heading action above the heading", () => {
    render(<LoginScreen onSubmit={vi.fn()} headingAction={<button type="button">Wstecz</button>} />);

    expect(screen.getByRole("button", { name: "Wstecz" })).toBeInTheDocument();
  });
});
