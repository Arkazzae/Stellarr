import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithConfirm } from "@/test/confirm";

import { Roster } from "./Roster";

describe("Roster presence groups", () => {
  it("keeps VC participants under online or offline instead of a call group", () => {
    const { container } = render(
      <Roster
        open
        online={[
          {
            id: "u-maja",
            displayName: "Maja",
            initials: "MA",
            presence: "online",
            speaking: true,
          },
        ]}
        offline={[
          {
            id: "u-nils",
            displayName: "Nils",
            initials: "NI",
            presence: "offline",
          },
        ]}
        voiceUserIds={new Set(["u-maja"])}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "W sieci1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Poza siecią1" })).toBeVisible();
    expect(screen.queryByText("W rozmowie")).toBeNull();
    expect(screen.getByText("Maja").closest(".person")).toHaveClass("speaking");
    expect(container.querySelectorAll(".person")).toHaveLength(2);
  });

  it("opens person actions from a touch-accessible button", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    renderWithConfirm(
      <Roster
        open
        online={[
          {
            id: "u-maja",
            displayName: "Maja",
            initials: "MA",
            presence: "online",
          },
        ]}
        offline={[]}
        voiceUserIds={new Set()}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onOpenProfile={vi.fn()}
        menu={{ onMessage }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Więcej działań: Maja" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("menuitem", { name: "Wyślij wiadomość" }));
    expect(onMessage).toHaveBeenCalledWith("u-maja");
  });
});
