import { vi } from "vitest";

import type { AccountSecurity } from "@/ports";

import type { AccountSecuritySectionsProps } from "./AccountSecuritySections";

/** One account's security state, shared by the sign-in and activity panes' tests. */
export const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export const SECURITY: AccountSecurity = {
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
  passkeyAvailable: false,
  identities: [],
  identityProviders: [],
  emailCodeAvailable: false,
};

export function securityProps(
  overrides: Partial<AccountSecuritySectionsProps> = {},
): AccountSecuritySectionsProps {
  return {
    security: SECURITY,
    loadError: null,
    actionError: null,
    busy: false,
    onAddMethod: vi.fn(),
    onRemoveMethod: vi.fn(),
    onRegenerateCodes: vi.fn(),
    onLinkIdentity: vi.fn(),
    onUnlinkIdentity: vi.fn(),
    onRevokeDevice: vi.fn(),
    sessions: [
      { id: "s-here", device: CHROME_MAC, ipAddress: "127.0.0.1", createdAt: "2026-11-12T17:00:00Z", lastSeenAt: "2026-11-12T17:10:00Z", expiresAt: "2026-12-12T17:00:00Z", current: true },
      { id: "s-phone", device: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1", ipAddress: "10.0.0.7", createdAt: "2026-11-11T17:00:00Z", lastSeenAt: "2026-11-11T18:00:00Z", expiresAt: "2026-12-11T17:00:00Z", current: false },
    ],
    onRevokeSession: vi.fn(),
    onRevokeOtherSessions: vi.fn(),
    ...overrides,
  };
}
