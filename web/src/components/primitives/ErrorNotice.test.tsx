import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorNotice } from "./ErrorNotice";

describe("ErrorNotice", () => {
  it("announces a concrete error and exposes its recovery", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();

    render(
      <ErrorNotice
        title="Kamera nie działa"
        message="Sprawdź, czy inne urządzenie jej nie używa."
        icon="camera"
        actions={[{ label: "Spróbuj ponownie", onClick: retry }]}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Kamera nie działa");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sprawdź, czy inne urządzenie jej nie używa.",
    );

    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
