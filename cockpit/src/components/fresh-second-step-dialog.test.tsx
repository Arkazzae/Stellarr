import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cockpitApi } from "@/lib/api";
import { selectPolish } from "@/test/locale";

import { FreshSecondStepDialog } from "./fresh-second-step-dialog";

selectPolish();

afterEach(() => {
  vi.unstubAllGlobals();
});

function refuse(code: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ status: 403, title: "Ta operacja wymaga drugiego kroku.", code }), {
        status: 403,
        headers: { "Content-Type": "application/problem+json" },
      }),
    ),
  );
}

describe("FreshSecondStepDialog", () => {
  it("opens when a change is refused for want of a fresh second step and leads to confirm it", async () => {
    refuse("fresh-mfa-required");
    render(<FreshSecondStepDialog />);

    await expect(cockpitApi.clearSecret("giphy.api-key")).rejects.toMatchObject({ status: 403, code: "fresh-mfa-required" });

    expect(await screen.findByText("Potwierdź drugi krok")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Potwierdź drugim krokiem" });
    expect(link.getAttribute("href")).toBe(`/login?confirm=1&fresh=1&returnUrl=${encodeURIComponent(window.location.pathname)}`);
  });

  it("stays closed for any other refusal", async () => {
    refuse("cockpit-mfa-required");
    render(<FreshSecondStepDialog />);

    await expect(cockpitApi.clearSecret("giphy.api-key")).rejects.toMatchObject({ status: 403 });

    await waitFor(() => expect(screen.queryByText("Potwierdź drugi krok")).toBeNull());
  });
});
