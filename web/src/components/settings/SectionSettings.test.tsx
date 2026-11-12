import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/ports";

import { SectionSettings, type SectionSettingsProps } from "./SectionSettings";

const SECTION = { id: "sec-1", name: "Gry" };

const MODERATOR: Role = {
  id: "mod",
  name: "Moderator",
  color: "#5865f2",
  permissions: [],
  memberCount: 3,
  isSystem: false,
  isOwner: false,
};

function props(overrides: Partial<SectionSettingsProps> = {}): SectionSettingsProps {
  return {
    open: true,
    onClose: vi.fn(),
    section: SECTION,
    supported: true,
    permissionsSupported: true,
    roles: [MODERATOR],
    permissionOverrides: [],
    onSave: vi.fn(() => Promise.resolve()),
    onSavePermissionOverride: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    deleteBlocked: false,
    onOpenRoles: vi.fn(),
    ...overrides,
  };
}

const nameField = () => screen.getByRole("textbox", { name: /Nazwa sekcji/ });
const saveButton = () => screen.getByRole("button", { name: /Zapisz zmiany|Zapisywanie…/ });
// The nav item and the pane's own button share the name, so look inside the pane.
const deleteButton = () =>
  within(screen.getByRole("region", { name: "Usuń sekcję" })).getByRole("button", {
    name: "Usuń sekcję",
  });
const goTo = (user: ReturnType<typeof userEvent.setup>, pane: string) =>
  user.click(
    within(screen.getByRole("navigation", { name: "Sekcje ustawień sekcji" })).getByRole(
      "button",
      { name: pane },
    ),
  );

describe("SectionSettings", () => {
  it("opens on the general pane of the section it is named after", () => {
    render(<SectionSettings {...props()} />);

    expect(screen.getByRole("dialog", { name: "Edytuj sekcję Gry" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ogólne" })).toBeInTheDocument();
    expect(nameField()).toHaveValue("Gry");
  });

  describe("rename", () => {
    it("offers save only for a new, non-empty name", async () => {
      const user = userEvent.setup();
      render(<SectionSettings {...props()} />);
      expect(saveButton()).toBeDisabled();

      await user.clear(nameField());
      expect(saveButton()).toBeDisabled();

      await user.type(nameField(), "  Gry  ");
      expect(saveButton()).toBeDisabled();

      await user.type(nameField(), "!");
      expect(saveButton()).toBeEnabled();
    });

    it("saves the trimmed name", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn(() => Promise.resolve());
      render(<SectionSettings {...props({ onSave })} />);

      await user.clear(nameField());
      await user.type(nameField(), "  Ogłoszenia ");
      await user.click(saveButton());

      expect(onSave).toHaveBeenCalledExactlyOnceWith({ name: "Ogłoszenia" });
    });

    it("blocks a second save while one is running", async () => {
      const user = userEvent.setup();
      let finish!: () => void;
      const onSave = vi.fn(
        () => new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      render(<SectionSettings {...props({ onSave })} />);

      await user.type(nameField(), "!");
      await user.click(saveButton());

      expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();
      finish();
      await vi.waitFor(() => expect(saveButton()).toHaveTextContent("Zapisz zmiany"));
    });

    it("reports a failed save and keeps what was typed", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockRejectedValue(new Error("boom"));
      render(<SectionSettings {...props({ onSave })} />);

      await user.type(nameField(), "!");
      await user.click(saveButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Nie udało się zapisać zmian sekcji.",
      );
      expect(nameField()).toHaveValue("Gry!");
    });

    it("takes the new name from the section once the rail has it", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<SectionSettings {...props()} />);
      await user.type(nameField(), "!");

      rerender(<SectionSettings {...props({ section: { id: "sec-1", name: "Gry!" } })} />);

      expect(nameField()).toHaveValue("Gry!");
      expect(saveButton()).toBeDisabled();
    });
  });

  describe("deleting", () => {
    it("asks for confirmation before deleting and can back out", async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn(() => Promise.resolve());
      render(<SectionSettings {...props({ onDelete })} />);
      await goTo(user, "Usuń sekcję");

      expect(screen.getByText(/Sekcja znika, a jej kanały wracają/)).toBeInTheDocument();
      await user.click(deleteButton());
      expect(onDelete).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Anuluj" }));
      expect(deleteButton()).toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("deletes once the named confirmation is pressed", async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn(() => Promise.resolve());
      render(<SectionSettings {...props({ onDelete })} />);
      await goTo(user, "Usuń sekcję");

      await user.click(deleteButton());
      await user.click(screen.getByRole("button", { name: "Usuń Gry" }));

      expect(onDelete).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: "Usuń Gry" })).toBeNull();
    });

    it("brings the confirmation back when the delete fails", async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn().mockRejectedValue(new Error("boom"));
      render(<SectionSettings {...props({ onDelete })} />);
      await goTo(user, "Usuń sekcję");

      await user.click(deleteButton());
      await user.click(screen.getByRole("button", { name: "Usuń Gry" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się usunąć sekcji.");
      expect(screen.getByRole("button", { name: "Usuń Gry" })).toBeEnabled();
    });

    it("explains a refusal because the section still has channels", async () => {
      const user = userEvent.setup();
      render(<SectionSettings {...props({ deleteBlocked: true })} />);
      await goTo(user, "Usuń sekcję");

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ta sekcja ma jeszcze przypisane kanały",
      );
    });
  });

  describe("permissions", () => {
    it("edits a role's override through the shared editor", async () => {
      const user = userEvent.setup();
      const onSavePermissionOverride = vi.fn(() => Promise.resolve());
      render(<SectionSettings {...props({ onSavePermissionOverride })} />);
      await goTo(user, "Uprawnienia");

      await user.click(screen.getByRole("button", { name: "Edytuj uprawnienia roli Moderator" }));
      await user.click(
        within(screen.getByRole("radiogroup", { name: "Dziennik zdarzeń" })).getByRole("radio", {
          name: "Odmów",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Zapisz" }));

      expect(onSavePermissionOverride).toHaveBeenCalledExactlyOnceWith("mod", {
        allow: [],
        deny: ["viewAuditLog"],
      });
    });

    it("keeps the editor read-only without permission to manage roles", async () => {
      const user = userEvent.setup();
      render(<SectionSettings {...props({ permissionsSupported: false })} />);
      await goTo(user, "Uprawnienia");

      expect(screen.getByText(/więc wyjątki są tylko do odczytu/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edytuj uprawnienia roli Moderator" }),
      ).toBeDisabled();
    });

    it("says so when the server has no roles, and still links to them", async () => {
      const user = userEvent.setup();
      const onOpenRoles = vi.fn();
      render(<SectionSettings {...props({ roles: [], onOpenRoles })} />);
      await goTo(user, "Uprawnienia");

      expect(screen.getByText("Ten serwer nie ma jeszcze ról.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Otwórz role serwera" }));
      expect(onOpenRoles).toHaveBeenCalledOnce();
    });
  });

  it("is read-only and says why without permission to manage channels", async () => {
    const user = userEvent.setup();
    render(<SectionSettings {...props({ supported: false })} />);

    expect(screen.getByText(/Nie masz uprawnienia do zarządzania kanałami/)).toBeInTheDocument();
    expect(nameField()).toBeDisabled();
    expect(saveButton()).toBeDisabled();

    await goTo(user, "Usuń sekcję");
    expect(deleteButton()).toBeDisabled();
  });

  it("returns to the general pane each time it opens", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SectionSettings {...props()} />);
    await goTo(user, "Uprawnienia");
    expect(screen.getByRole("heading", { name: "Uprawnienia" })).toBeInTheDocument();

    rerender(<SectionSettings {...props({ open: false })} />);
    rerender(<SectionSettings {...props()} />);

    expect(screen.getByRole("heading", { name: "Ogólne" })).toBeInTheDocument();
  });

  it("closes from the footer", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SectionSettings {...props({ onClose })} />);

    const footer = screen.getAllByRole("button", { name: "Zamknij" });
    await user.click(footer[footer.length - 1]!);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
