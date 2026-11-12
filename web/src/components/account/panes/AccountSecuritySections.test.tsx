import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AccountSecurity } from "@/ports";
import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { AccountSecuritySections, type AccountSecuritySectionsProps } from "./AccountSecuritySections";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const SECURITY: AccountSecurity = {
  requirement: "optional",
  mfaRequired: false,
  freshMfa: false,
  methods: [
    { id: "m-app", type: "totp", name: "Telefon", createdAt: "2026-11-12T17:00:00Z", pending: false },
    { id: "m-new", type: "totp", name: "Tablet", createdAt: "2026-11-12T17:05:00Z", pending: true },
  ],
  remainingRecoveryCodes: 7,
  trustedDevices: [
    {
      id: "d-1",
      name: "Unknown device",
      device: CHROME_MAC,
      createdAt: "2026-11-12T17:00:00Z",
      expiresAt: "2026-11-26T17:00:00Z",
    },
  ],
  recentEvents: [
    { id: "e-1", kind: "method-added", detail: "totp", ipAddress: "127.0.0.1", device: CHROME_MAC, createdAt: "2026-11-12T17:00:00Z" },
    { id: "e-2", kind: "something-new", detail: "", ipAddress: "127.0.0.1", device: "curl/8.7.1", createdAt: "2026-11-12T17:01:00Z" },
  ],
  trustedDeviceDays: 14,
  emailCodeAvailable: false,
};

function setup(overrides: Partial<AccountSecuritySectionsProps> = {}) {
  const props: AccountSecuritySectionsProps = {
    security: SECURITY,
    loadError: null,
    actionError: null,
    busy: false,
    onAddMethod: vi.fn(),
    onRemoveMethod: vi.fn(),
    onRegenerateCodes: vi.fn(),
    onRevokeDevice: vi.fn(),
    ...overrides,
  };
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

  it("offers to turn the second step on when there is no method", async () => {
    const user = userEvent.setup();
    const props = setup({ security: { ...SECURITY, methods: [] } });

    expect(screen.getByText("Wyłączone")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Włącz" }));

    expect(props.onAddMethod).toHaveBeenCalledOnce();
  });

  it("names devices by browser and system, and history entries it does not know by their kind", () => {
    setup();

    expect(screen.getByText("Chrome na macOS")).toBeVisible();
    expect(screen.getByText("Dodana metoda")).toBeVisible();
    expect(screen.getByText("Zdarzenie: something-new")).toBeVisible();
  });
});
