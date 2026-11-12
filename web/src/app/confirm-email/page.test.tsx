import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";

import ConfirmEmailPage from "./page";

const mocks = vi.hoisted(() => ({ confirm: vi.fn<(token: string) => Promise<"changed" | "invalid" | "taken">>() }));

vi.mock("@/state/hooks", () => ({
  usePorts: () => ({ session: { confirmEmailChange: mocks.confirm } }),
  useLanguage: () => ({
    t: (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values),
  }),
}));

const t = (key: MessageKey) => translateMessage("pl", key);

async function open(token?: string | string[]) {
  render(await ConfirmEmailPage({ searchParams: Promise.resolve(token === undefined ? {} : { token }) }));
}

beforeEach(() => {
  mocks.confirm = vi.fn(async () => "changed" as const);
});

describe("ConfirmEmailPage", () => {
  it("changes nothing until the button is pressed, then says the address changed", async () => {
    const user = userEvent.setup();
    await open("abc");

    expect(mocks.confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("confirmEmail.confirm") }));

    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith("abc");
    expect(await screen.findByRole("heading", { name: t("confirmEmail.changedTitle") })).toBeVisible();
  });

  it("explains a spent or expired link", async () => {
    mocks.confirm = vi.fn(async () => "invalid" as const);
    const user = userEvent.setup();
    await open("abc");

    await user.click(screen.getByRole("button", { name: t("confirmEmail.confirm") }));

    expect(await screen.findByText(t("confirmEmail.invalid"))).toBeVisible();
  });

  it("reads a missing or repeated token as an invalid link without asking the server", async () => {
    await open(["a", "b"]);

    expect(screen.getByText(t("confirmEmail.invalid"))).toBeVisible();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
