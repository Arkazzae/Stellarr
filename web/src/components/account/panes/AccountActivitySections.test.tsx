import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { AccountActivitySections } from "./AccountActivitySections";
import type { AccountSecuritySectionsProps } from "./AccountSecuritySections";
import { SECURITY, securityProps } from "./securityTestFixtures";

function setup(overrides: Partial<AccountSecuritySectionsProps> = {}) {
  const props = securityProps(overrides);
  renderWithConfirm(<AccountActivitySections {...props} />);
  return props;
}

describe("AccountActivitySections", () => {
  it("names devices by browser and system, and history entries it does not know by their kind", () => {
    setup();

    // The trusted device and the current session are the same browser.
    expect(screen.getAllByText("Chrome na macOS")).toHaveLength(2);
    expect(screen.getByText("Safari na iOS")).toBeVisible();
    expect(screen.getByText("Dodana metoda")).toBeVisible();
    expect(screen.getByText("Zdarzenie: something-new")).toBeVisible();
  });

  it("signs out another device, never this one, and the others only after confirming", async () => {
    const user = userEvent.setup();
    const props = setup();

    expect(screen.getByText("To urządzenie, 127.0.0.1")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Wyloguj" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(props.onRevokeSession).toHaveBeenCalledExactlyOnceWith(props.sessions?.[1]);

    await user.click(screen.getByRole("button", { name: "Wyloguj pozostałe" }));
    expect(props.onRevokeOtherSessions).not.toHaveBeenCalled();
    await answerConfirm(user, "Wyloguj pozostałe");
    expect(props.onRevokeOtherSessions).toHaveBeenCalledOnce();
  });

  it("puts the sessions first, before the devices and the history", () => {
    setup();

    const headings = [...document.querySelectorAll(".sc-h")].map((header) => header.textContent);
    expect(headings).toEqual(["Aktywne sesje", "Zaufane urządzenia", "Historia bezpieczeństwa"]);
  });

  it("leaves trusted devices out until there is a second step to skip", () => {
    setup({ security: { ...SECURITY, methods: [], trustedDevices: [] } });

    expect(screen.queryByText("Zaufane urządzenia")).toBeNull();
    expect(screen.getByText("Historia bezpieczeństwa")).toBeVisible();
  });

  it("says why it is empty when the state could not be loaded, and what failed", () => {
    setup({
      security: null,
      sessions: null,
      loadError: "Nie udało się wczytać zabezpieczeń konta.",
      actionError: "Nie udało się. Spróbuj ponownie.",
    });

    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Nie udało się wczytać zabezpieczeń konta.",
      "Nie udało się. Spróbuj ponownie.",
    ]);
  });
});
