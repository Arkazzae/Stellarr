import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitUser, type CockpitUserSecurity } from "@/lib/api";
import { UserSecuritySheet } from "@/pages/users/user-security-sheet";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    cockpitApi: {
      ...original.cockpitApi,
      userSecurity: vi.fn(),
      recoverUser: vi.fn(),
      unlinkUserIdentity: vi.fn(),
    },
  };
});

const api = vi.mocked(cockpitApi);

const ADA = {
  id: "u-ada",
  username: "ada",
  displayName: "Ada",
  email: "ada@example.test",
  avatarColor: "#888888",
  avatarUrl: null,
  presence: "offline",
  realtimeConnections: 0,
  roleId: "r-member",
  roleName: "Członek",
  isDisabled: false,
  joinedAt: "2026-11-01T10:00:00Z",
} as CockpitUser;

const SECURITY: CockpitUserSecurity = {
  userId: "u-ada",
  recoveryRequired: false,
  methods: [
    { id: "m-1", type: "totp", name: "Telefon", confirmed: true, createdAt: "2026-11-12T10:00:00Z", lastUsedAt: null },
  ],
  remainingRecoveryCodes: 7,
  trustedDevices: 1,
  identities: [{ id: "i-1", name: "Keycloak", issuer: "https://id.example.test", createdAt: "2026-11-12T10:00:00Z" }],
  events: [{ kind: "method-added", ipAddress: "192.0.2.1", createdAt: "2026-11-12T10:00:00Z" }],
};

beforeEach(() => {
  api.userSecurity.mockReset().mockResolvedValue(SECURITY);
  api.recoverUser.mockReset().mockResolvedValue({
    credential: "recovery-credential-value",
    expiresAt: "2026-11-12T10:10:00Z",
    methodsRevoked: 1,
    trustedDevicesRevoked: 1,
    sessionsRevoked: 2,
  });
  api.unlinkUserIdentity.mockReset().mockResolvedValue(undefined);
});

describe("UserSecuritySheet", () => {
  it("shows what protects the account without any secret", async () => {
    render(<UserSecuritySheet user={ADA} open onOpenChange={() => undefined} />);

    expect(await screen.findByText("Telefon")).toBeTruthy();
    expect(screen.getByText(/Aplikacja uwierzytelniająca/)).toBeTruthy();
    expect(screen.getByText("Kody odzyskiwania: 7", { exact: false })).toBeTruthy();
    expect(screen.getByText("Keycloak")).toBeTruthy();
    expect(screen.getByText(/Dodano metodę/)).toBeTruthy();
    expect(api.userSecurity).toHaveBeenCalledWith("u-ada");
  });

  it("recovers the account after a reason and shows the code once", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(<UserSecuritySheet user={ADA} open onOpenChange={onOpenChange} />);

    await screen.findByText("Telefon");
    const recover = screen.getByRole("button", { name: "Odzyskaj dostęp" });
    expect((recover as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Powód"), "zgubiony telefon");
    await user.click(screen.getByRole("button", { name: "Odzyskaj dostęp" }));

    expect(api.recoverUser).toHaveBeenCalledExactlyOnceWith("u-ada", "zgubiony telefon");
    expect(await screen.findByText("recovery-credential-value")).toBeTruthy();
    expect(screen.getByText(/sesje 2/)).toBeTruthy();

    // Closed and opened again, the code is gone.
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<UserSecuritySheet user={ADA} open={false} onOpenChange={onOpenChange} />);
    rerender(<UserSecuritySheet user={ADA} open onOpenChange={onOpenChange} />);
    await screen.findByText("Telefon");
    expect(screen.queryByText("recovery-credential-value")).toBeNull();
  });

  it("unlinks a provider account and reads the state again", async () => {
    const user = userEvent.setup();
    render(<UserSecuritySheet user={ADA} open onOpenChange={() => undefined} />);

    await screen.findByText("Keycloak");
    await user.click(screen.getByRole("button", { name: "Odłącz" }));

    expect(api.unlinkUserIdentity).toHaveBeenCalledExactlyOnceWith("u-ada", "i-1");
    await waitFor(() => expect(api.userSecurity).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Odłączono konto u dostawcy.")).toBeTruthy();
  });
});
