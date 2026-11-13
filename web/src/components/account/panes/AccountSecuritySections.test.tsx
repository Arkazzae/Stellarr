import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { AccountSecuritySections, type AccountSecuritySectionsProps } from "./AccountSecuritySections";
import { SECURITY, securityProps } from "./securityTestFixtures";

function setup(overrides: Partial<AccountSecuritySectionsProps> = {}) {
  const props = securityProps(overrides);
  renderWithConfirm(<AccountSecuritySections {...props} />);
  return props;
}

describe("AccountSecuritySections", () => {
  it("lists confirmed methods only, with the codes left", () => {
    setup();

    expect(screen.getByText("Telefon")).toBeVisible();
    expect(screen.queryByText("Tablet")).toBeNull();
    expect(screen.getByText("Pozostało: 7")).toBeVisible();
  });

  it("removes a method only after it is confirmed", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: "Usuń" }));
    expect(props.onRemoveMethod).not.toHaveBeenCalled();
    await answerConfirm(user, "Usuń");

    expect(props.onRemoveMethod).toHaveBeenCalledExactlyOnceWith(SECURITY.methods[0]);
  });

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
    expect(screen.queryByRole("button", { name: "Połącz z Work" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Połącz z Keycloak" }));
    expect(props.onLinkIdentity).toHaveBeenCalledExactlyOnceWith({ id: "default", displayName: "Keycloak" });

    await user.click(screen.getByRole("button", { name: "Odłącz" }));
    expect(props.onUnlinkIdentity).not.toHaveBeenCalled();
    await answerConfirm(user, "Odłącz");
    expect(props.onUnlinkIdentity).toHaveBeenCalledExactlyOnceWith(linked);
  });

  it("shows no provider section on an instance without identity providers", () => {
    setup();

    expect(screen.queryByText("Logowanie przez dostawcę")).toBeNull();
  });

  it("offers to turn the second step on when there is no method", async () => {
    const user = userEvent.setup();
    const props = setup({ security: { ...SECURITY, methods: [] } });

    expect(screen.getByText("Wyłączone")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Włącz" }));

    expect(props.onAddMethod).toHaveBeenCalledOnce();
  });
});
