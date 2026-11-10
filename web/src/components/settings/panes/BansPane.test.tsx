import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Ban } from "@/ports";

import { BansPane } from "./BansPane";

const BANS: Ban[] = [
  {
    userId: "u-ola",
    displayName: "Ola",
    bannedByName: "Jan",
    reason: "spam",
    bannedAt: new Date(2026, 2, 6, 12).toISOString(),
  },
  {
    userId: "u-adam",
    displayName: "Adam",
    bannedByName: "Maja",
    reason: "reklamy",
    bannedAt: new Date(2026, 3, 1, 12).toISOString(),
  },
];

describe("BansPane", () => {
  it("lists who was banned, by whom, why and when", () => {
    render(<BansPane supported bans={BANS} onUnban={vi.fn()} />);

    expect(screen.getByText("Lista banów — 2")).toBeVisible();
    expect(screen.getByText("zbanował·a Jan · spam · 6.03.2026")).toBeVisible();
    expect(screen.getByText("zbanował·a Maja · reklamy · 1.04.2026")).toBeVisible();
  });

  it("lifts the ban of the chosen person", async () => {
    const user = userEvent.setup();
    const onUnban = vi.fn().mockResolvedValue(undefined);
    render(<BansPane supported bans={BANS} onUnban={onUnban} />);

    await user.click(screen.getByRole("button", { name: "Odbanuj Ola" }));

    expect(onUnban).toHaveBeenCalledExactlyOnceWith("u-ola");
  });

  it("disables every unban while one is in flight", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const onUnban = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<BansPane supported bans={BANS} onUnban={onUnban} />);

    await user.click(screen.getByRole("button", { name: "Odbanuj Ola" }));

    expect(screen.getByRole("button", { name: "Odbanuj Ola" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Odbanuj Adam" })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Odbanuj Adam" })).toBeEnabled());
  });

  it("says so when lifting a ban fails, and clears the message on the next try", async () => {
    const user = userEvent.setup();
    const onUnban = vi
      .fn<(userId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<BansPane supported bans={BANS} onUnban={onUnban} />);

    await user.click(screen.getByRole("button", { name: "Odbanuj Ola" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się usunąć bana.");

    await user.click(screen.getByRole("button", { name: "Odbanuj Adam" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps unban disabled and explains why without the permission", () => {
    render(<BansPane supported={false} bans={BANS} onUnban={vi.fn()} />);

    expect(screen.getByText("Nie masz uprawnienia do zarządzania banami.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Odbanuj Ola" })).toBeDisabled();
  });
});
