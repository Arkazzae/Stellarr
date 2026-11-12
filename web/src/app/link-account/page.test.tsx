import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";

import LinkAccountPage from "./page";

vi.mock("@/state/hooks", () => ({
  useLanguage: () => ({
    t: (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values),
  }),
}));

const t = (key: MessageKey) => translateMessage("pl", key);

async function show(result?: string | string[]) {
  render(await LinkAccountPage({ searchParams: Promise.resolve(result === undefined ? {} : { result }) }));
}

describe("LinkAccountPage", () => {
  it("says the account was linked and leads back to the app", async () => {
    await show("linked");

    expect(screen.getByRole("heading", { name: t("linkAccount.linkedTitle") })).toBeVisible();
    expect(screen.getByText(t("linkAccount.linked"))).toBeVisible();
    expect(screen.getByRole("link", { name: t("linkAccount.back") })).toHaveAttribute("href", "/");
  });

  it("explains an identity that belongs to another account", async () => {
    await show("taken");

    expect(screen.getByRole("heading", { name: t("linkAccount.failedTitle") })).toBeVisible();
    expect(screen.getByText(t("linkAccount.taken"))).toBeVisible();
  });

  it("reads anything it does not know as a failure, never as a success", async () => {
    await show(["linked", "linked"]);
    expect(screen.getByText(t("linkAccount.failed"))).toBeVisible();
  });
});
