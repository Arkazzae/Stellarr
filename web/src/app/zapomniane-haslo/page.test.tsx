import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";

import ForgotPasswordPage from "./page";

const mocks = vi.hoisted(() => ({
  ports: { session: { requestPasswordReset: vi.fn() } },
}));

vi.mock("@/state/hooks", () => ({
  usePorts: () => mocks.ports,
  useLanguage: () => ({ t: (key: MessageKey) => translateMessage("pl", key) }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ForgotPasswordPage", () => {
  it("asks the server to mail a reset link to the typed address", async () => {
    const user = userEvent.setup();
    mocks.ports.session.requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);

    await user.type(screen.getByRole("textbox", { name: "E-mail" }), "maja@example.com");
    await user.click(screen.getByRole("button", { name: "Wyślij link do zmiany hasła" }));

    expect(mocks.ports.session.requestPasswordReset).toHaveBeenCalledExactlyOnceWith(
      "maja@example.com",
    );
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});
