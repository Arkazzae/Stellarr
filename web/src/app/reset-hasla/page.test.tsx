import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";

import ResetPasswordPage from "./page";

const mocks = vi.hoisted(() => ({
  ports: { session: { resetPassword: vi.fn() } },
}));

vi.mock("@/state/hooks", () => ({
  usePorts: () => mocks.ports,
  useLanguage: () => ({ t: (key: MessageKey) => translateMessage("pl", key) }),
}));

async function renderWithQuery(token: string | string[] | undefined) {
  render(await ResetPasswordPage({ searchParams: Promise.resolve({ token }) }));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ResetPasswordPage", () => {
  it("sets the new password with the token from the mailed link", async () => {
    const user = userEvent.setup();
    mocks.ports.session.resetPassword.mockResolvedValue(undefined);
    await renderWithQuery("mailed-token");

    await user.type(screen.getByLabelText("Nowe hasło"), "haslo1234");
    await user.type(screen.getByLabelText("Powtórz nowe hasło"), "haslo1234");
    await user.click(screen.getByRole("button", { name: "Ustaw nowe hasło" }));

    expect(mocks.ports.session.resetPassword).toHaveBeenCalledExactlyOnceWith(
      "mailed-token",
      "haslo1234",
    );
  });

  it.each([
    ["is missing", undefined],
    ["is given twice", ["one", "two"]],
  ])("treats a token that %s as no token", async (_case, token) => {
    await renderWithQuery(token);

    expect(screen.getByRole("heading", { name: "Link jest niepełny" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Nowe hasło")).not.toBeInTheDocument();
  });
});
