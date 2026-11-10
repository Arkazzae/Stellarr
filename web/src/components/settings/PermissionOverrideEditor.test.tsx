import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PermissionOverride, Role } from "@/ports";

import { PermissionOverrideEditor } from "./PermissionOverrideEditor";

const role = (id: string, name: string): Role => ({
  id,
  name,
  color: "#5865f2",
  permissions: [],
  memberCount: 0,
  isSystem: false,
  isOwner: false,
});

const ROLES = [role("mod", "Moderator"), role("guest", "Gość")];

const MOD_OVERRIDE: PermissionOverride = {
  roleId: "mod",
  allow: ["manageChannels", "manageMessages"],
  deny: ["manageBans"],
};

function renderEditor(
  props: Partial<Parameters<typeof PermissionOverrideEditor>[0]> = {},
) {
  const onSave = vi.fn(() => Promise.resolve());
  render(
    <PermissionOverrideEditor
      supported
      roles={ROLES}
      overrides={[MOD_OVERRIDE]}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

const openRole = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("button", { name: `Edytuj uprawnienia roli ${name}` }));

const grant = (permission: string, option: string) =>
  within(screen.getByRole("radiogroup", { name: permission })).getByRole("radio", {
    name: option,
  });

describe("PermissionOverrideEditor", () => {
  it("summarises what each role's override changes", () => {
    renderEditor();

    expect(screen.getByText("+2 zezwoleń")).toBeInTheDocument();
    expect(screen.getByText("−1 odmów")).toBeInTheDocument();
    expect(screen.getByText("Dziedziczy wszystko z roli")).toBeInTheDocument();
  });

  it("opens a role on the grants it already has, inheriting the rest", async () => {
    const { user } = renderEditor();
    await openRole(user, "Moderator");

    expect(grant("Zarządzanie kanałami", "Zezwól")).toBeChecked();
    expect(grant("Moderowanie wiadomości", "Zezwól")).toBeChecked();
    expect(grant("Zarządzanie banami", "Odmów")).toBeChecked();
    expect(grant("Zarządzanie serwerem", "Dziedzicz")).toBeChecked();
    expect(grant("Dziennik zdarzeń", "Dziedzicz")).toBeChecked();
  });

  it("starts a role without an override on inherit everywhere", async () => {
    const { user } = renderEditor();
    await openRole(user, "Gość");

    expect(screen.getAllByRole("radio", { name: "Dziedzicz", checked: true })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });

  it("saves the changed grants as allow and deny lists", async () => {
    const { user, onSave } = renderEditor();
    await openRole(user, "Moderator");

    await user.click(grant("Zarządzanie serwerem", "Zezwól"));
    await user.click(grant("Zarządzanie kanałami", "Odmów"));
    await user.click(grant("Zarządzanie banami", "Dziedzicz"));
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("mod", {
      allow: ["manageMessages", "manageServer"],
      deny: ["manageChannels"],
    });
  });

  it("lets deny win when a permission ends up on both sides", async () => {
    const { user, onSave } = renderEditor({
      overrides: [{ roleId: "mod", allow: ["manageBans"], deny: ["manageBans"] }],
    });
    await openRole(user, "Moderator");

    expect(grant("Zarządzanie banami", "Odmów")).toBeChecked();
    await user.click(grant("Zarządzanie banami", "Zezwól"));
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(onSave).toHaveBeenCalledWith("mod", { allow: ["manageBans"], deny: [] });
  });

  it("keeps save off until something differs from what is stored", async () => {
    const { user } = renderEditor();
    await openRole(user, "Moderator");
    const save = screen.getByRole("button", { name: "Zapisz" });
    expect(save).toBeDisabled();

    await user.click(grant("Zarządzanie serwerem", "Odmów"));
    expect(save).toBeEnabled();

    await user.click(grant("Zarządzanie serwerem", "Dziedzicz"));
    expect(save).toBeDisabled();
  });

  it("drops an unsaved edit on cancel and when the role is reopened", async () => {
    const { user } = renderEditor();
    await openRole(user, "Moderator");

    await user.click(grant("Zarządzanie serwerem", "Zezwól"));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(grant("Zarządzanie serwerem", "Dziedzicz")).toBeChecked();

    await user.click(grant("Zarządzanie serwerem", "Zezwól"));
    await openRole(user, "Moderator");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    await openRole(user, "Moderator");
    expect(grant("Zarządzanie serwerem", "Dziedzicz")).toBeChecked();
  });

  it("disables save while the request is in flight and explains a failure", async () => {
    let fail!: (cause: Error) => void;
    const onSave = vi.fn(
      () => new Promise<void>((_, reject) => {
        fail = reject;
      }),
    );
    const { user } = renderEditor({ onSave });
    await openRole(user, "Gość");
    await user.click(grant("Dziennik zdarzeń", "Zezwól"));
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();

    fail(new Error("nope"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się zapisać nadpisania uprawnień.",
    );
    expect(grant("Dziennik zdarzeń", "Zezwól")).toBeChecked();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeEnabled();
  });

  it("stays read-only and says why when overrides are not supported", async () => {
    renderEditor({ supported: false });

    expect(
      screen.getByText("Wyjątki uprawnień nie są jeszcze podpięte do backendu."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edytuj uprawnienia roli Moderator" }),
    ).toBeDisabled();
  });
});
