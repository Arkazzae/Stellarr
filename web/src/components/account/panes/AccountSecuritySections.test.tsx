import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import {
  IdentitiesSection,
  TwoStepSection,
  type AccountSecuritySectionsProps,
} from "./AccountSecuritySections";
import { SECURITY, securityProps } from "./securityTestFixtures";

function setup(overrides: Partial<AccountSecuritySectionsProps> = {}, email = "maja@example.com") {
  const props = securityProps(overrides);
  renderWithConfirm(
    <>
      <TwoStepSection {...props} email={email} />
      <IdentitiesSection {...props} />
    </>,
  );
  return props;
}

const OFF = { ...SECURITY, methods: [], emailCodeAvailable: true, passkeyAvailable: true };

describe("TwoStepSection", () => {
  it("lists confirmed methods only, with what kind each is and the codes left", () => {
    setup();

    expect(screen.getByText("Włączone: do wejścia potrzeba hasła i drugiego kroku")).toBeVisible();
    expect(screen.getByText("Telefon")).toBeVisible();
    expect(screen.getByText(/^Aplikacja uwierzytelniająca · Dodana/)).toBeVisible();
    expect(screen.queryByText("Tablet")).toBeNull();
    expect(screen.getByText(/^Zostało: 7\./)).toBeVisible();
  });

  it("removes a method only after it is confirmed", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Usuń metodę Telefon" }));
    expect(props.onRemoveMethod).not.toHaveBeenCalled();
    await answerConfirm(user, "Usuń");

    expect(props.onRemoveMethod).toHaveBeenCalledExactlyOnceWith(SECURITY.methods[0]);
  });

  it("warns as the recovery codes run low and when none are left", () => {
    const { unmount } = renderWithConfirm(
      <TwoStepSection {...securityProps({ security: { ...SECURITY, remainingRecoveryCodes: 2 } })} email="" />,
    );
    expect(screen.getByText(/^Zostało już niewiele: 2\./)).toHaveAttribute("data-tone", "warn");
    unmount();

    renderWithConfirm(
      <TwoStepSection {...securityProps({ security: { ...SECURITY, remainingRecoveryCodes: 0 } })} email="" />,
    );
    expect(screen.getByText(/^Nie masz już kodów zapasowych/)).toHaveAttribute("data-tone", "bad");
  });

  it("says the password alone opens the account, and starts the way picked", async () => {
    const user = userEvent.setup();
    const props = setup({ security: OFF });

    expect(screen.getByText("Do konta wystarcza samo hasło")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Klucz dostępu/ }));
    expect(props.onAddMethod).toHaveBeenLastCalledWith("passkey");
    await user.click(screen.getByRole("button", { name: /^Kod mailem Kod przyjdzie na maja@example.com/ }));
    expect(props.onAddMethod).toHaveBeenLastCalledWith("email");
    await user.click(screen.getByRole("button", { name: /^Aplikacja uwierzytelniająca/ }));
    expect(props.onAddMethod).toHaveBeenLastCalledWith("totp");
  });

  it("offers only the ways the server can check, and mail only to an address", () => {
    setup({ security: { ...OFF, emailCodeAvailable: true, passkeyAvailable: false } }, "");

    expect(screen.getByRole("button", { name: /^Aplikacja uwierzytelniająca/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Kod mailem/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Klucz dostępu/ })).toBeNull();
  });

  it("says when the server requires a second step", () => {
    setup({ security: { ...OFF, mfaRequired: true } });

    expect(screen.getByText("Ten serwer wymaga drugiego kroku")).toBeVisible();
  });

  it("adds another method on the way picked", async () => {
    const user = userEvent.setup();
    const props = setup({ security: { ...SECURITY, passkeyAvailable: true } });

    await user.click(screen.getByRole("button", { name: "Dodaj metodę: Klucz dostępu" }));

    expect(props.onAddMethod).toHaveBeenCalledExactlyOnceWith("passkey");
  });

  it("holds every action while one is running", () => {
    setup({ busy: true });

    expect(screen.getByRole("button", { name: "Usuń metodę Telefon" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wygeneruj nowe" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dodaj metodę: Aplikacja uwierzytelniająca" })).toBeDisabled();
  });

  it("says it is loading, why it could not load, and why an action failed", () => {
    const { unmount } = renderWithConfirm(
      <TwoStepSection {...securityProps({ security: null })} email="" />,
    );
    expect(screen.getByText("Wczytywanie…")).toBeVisible();
    unmount();

    const failed = renderWithConfirm(
      <TwoStepSection {...securityProps({ security: null, loadError: "Brak połączenia." })} email="" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Brak połączenia.");
    failed.unmount();

    renderWithConfirm(<TwoStepSection {...securityProps({ actionError: "Nie udało się." })} email="" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się.");
  });
});

describe("IdentitiesSection", () => {
  it("lists linked provider accounts and offers only the providers not linked yet", async () => {
    const user = userEvent.setup();
    const linked = { id: "i-1", providerId: "work", name: "Work", createdAt: "2026-11-12T17:00:00Z" };
    const props = setup({
      security: {
        ...SECURITY,
        identities: [linked],
        identityProviders: [
          { id: "default", displayName: "Keycloak" },
          { id: "work", displayName: "Work" },
        ],
      },
    });

    expect(screen.getByText("Work")).toBeVisible();
    expect(screen.getByText("Niepołączone")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Połącz z Work" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Połącz z Keycloak" }));
    expect(props.onLinkIdentity).toHaveBeenCalledExactlyOnceWith({ id: "default", displayName: "Keycloak" });

    await user.click(screen.getByRole("button", { name: "Odłącz Work" }));
    expect(props.onUnlinkIdentity).not.toHaveBeenCalled();
    await answerConfirm(user, "Odłącz");
    expect(props.onUnlinkIdentity).toHaveBeenCalledExactlyOnceWith(linked);
  });

  it("shows no provider section on an instance without identity providers", () => {
    setup();

    expect(screen.queryByText("Logowanie przez dostawcę")).toBeNull();
  });
});
