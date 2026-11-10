import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Invite } from "@/ports";
import { fakeAdminPort } from "@/test/adminPort";
import { harness, resetHarness } from "@/test/modalsHarness";

import { InviteDialog } from "./InviteDialog";
import { useServerAdmin } from "./useServerAdmin";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const modal = vi.hoisted(() => ({ onCreateInvite: undefined as (() => Promise<void>) | undefined }));

// The real dialog gives its create button no pending state, so the promise it
// is handed is the only place to see how long a creation takes.
vi.mock("@/components/settings/InviteModal", () => ({
  InviteModal: (props: { onCreateInvite?: () => Promise<void> }) => {
    modal.onCreateInvite = props.onCreateInvite;
    return null;
  },
}));

const INVITE: Invite = {
  id: "inv-1",
  url: "https://chat.example/invite/abc123",
  createdByName: "Maja",
  uses: 0,
  maxUses: null,
  expiresAt: null,
};

function Dialog() {
  return <InviteDialog open {...useServerAdmin(true)} />;
}

beforeEach(() => {
  resetHarness();
  modal.onCreateInvite = undefined;
});

describe("InviteDialog", () => {
  it("finishes creating a link without waiting for the lists to come back", async () => {
    const listInvites = vi
      .fn<() => Promise<Invite[]>>()
      .mockResolvedValueOnce([INVITE])
      .mockReturnValueOnce(new Promise(() => {}));
    harness.ports.admin = fakeAdminPort({ listInvites, createInvite: vi.fn(async () => INVITE) });
    render(<Dialog />);
    await waitFor(() => expect(listInvites).toHaveBeenCalledOnce());

    await expect(modal.onCreateInvite?.()).resolves.toBeUndefined();

    expect(harness.ports.admin.createInvite).toHaveBeenCalledOnce();
    await waitFor(() => expect(listInvites).toHaveBeenCalledTimes(2));
  });
});
