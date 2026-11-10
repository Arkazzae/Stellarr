import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import { fakeAdminPort } from "@/test/adminPort";
import { harness, resetHarness } from "@/test/modalsHarness";

import { ModalsContainer } from "./ModalsContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const t = (key: MessageKey, values?: Record<string, string | number>) =>
  translateMessage("pl", key, values);

beforeEach(() => {
  resetHarness();
  harness.directory.sections = [{ id: "s-a", name: "Alpha" }];
});

function openSectionSettings() {
  harness.ui.modal = "section";
  harness.ui.sectionSettingsId = "s-a";
  return render(<ModalsContainer />);
}

async function askToDelete() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: t("section.delete") }));
  const pane = document.querySelector<HTMLElement>('[data-pane="danger"]')!;
  await user.click(within(pane).getByRole("button", { name: t("section.delete") }));
  await user.click(
    within(pane).getByRole("button", { name: t("settings.deleteNamedServer", { name: "Alpha" }) }),
  );
}

describe("ModalsContainer: section settings", () => {
  it("renames the section", async () => {
    const user = userEvent.setup();
    openSectionSettings();

    const name = screen.getByRole("textbox", { name: new RegExp(`^${t("section.name")}`) });
    await user.clear(name);
    await user.type(name, "Beta");
    await user.click(screen.getByRole("button", { name: t("channel.settingsSave") }));

    expect(harness.ports.admin.updateSection).toHaveBeenCalledExactlyOnceWith("s-a", { name: "Beta" });
  });

  it("deletes the section and closes the dialog", async () => {
    openSectionSettings();

    await askToDelete();

    await waitFor(() => expect(harness.ui.closeModal).toHaveBeenCalledOnce());
    expect(harness.ports.admin.deleteSection).toHaveBeenCalledExactlyOnceWith("s-a");
  });

  it("explains that channels still sit under a section the server refuses to delete", async () => {
    harness.ports.admin = fakeAdminPort({
      deleteSection: vi.fn(async () => {
        throw new ApiError("invalid", "has channels", 409);
      }),
    });
    openSectionSettings();

    await askToDelete();

    expect(await screen.findByText(t("section.deleteBlocked"))).toBeVisible();
    expect(harness.ui.closeModal).not.toHaveBeenCalled();
  });

  it("does not call a refusal from another cause a blocked section", async () => {
    harness.ports.admin = fakeAdminPort({
      deleteSection: vi.fn(async () => {
        throw new ApiError("server", "boom", 500);
      }),
    });
    openSectionSettings();

    await askToDelete();

    expect(await screen.findByText(t("section.deleteFailed"))).toBeVisible();
    expect(screen.queryByText(t("section.deleteBlocked"))).not.toBeInTheDocument();
  });

  it("forgets that deletion was blocked once the dialog closes", async () => {
    harness.ports.admin = fakeAdminPort({
      deleteSection: vi.fn(async () => {
        throw new ApiError("invalid", "has channels", 409);
      }),
    });
    const { rerender } = openSectionSettings();
    await askToDelete();
    await screen.findByText(t("section.deleteBlocked"));

    harness.ui.modal = null;
    rerender(<ModalsContainer />);
    harness.ui.modal = "section";
    rerender(<ModalsContainer />);
    await userEvent.setup().click(screen.getByRole("button", { name: t("section.delete") }));

    expect(screen.queryByText(t("section.deleteBlocked"))).not.toBeInTheDocument();
  });
});

describe("ModalsContainer: new section", () => {
  async function createSection(name: string) {
    const user = userEvent.setup();
    harness.ui.modal = "section-new";
    render(<ModalsContainer />);
    await user.type(screen.getByRole("textbox", { name: new RegExp(`^${t("section.name")}`) }), name);
    await user.click(screen.getByRole("button", { name: t("section.new") }));
  }

  it("creates the section and closes", async () => {
    await createSection("  Games ");

    await waitFor(() => expect(harness.ui.closeModal).toHaveBeenCalledOnce());
    expect(harness.ports.admin.createSection).toHaveBeenCalledExactlyOnceWith({ name: "Games" });
  });

  it("words an API failure by its kind", async () => {
    harness.ports.admin = fakeAdminPort({
      createSection: vi.fn(async () => {
        throw new ApiError("rate-limited", "slow down", 429);
      }),
    });

    await createSection("Games");

    expect(await screen.findByText(t("session.rateLimited"))).toBeVisible();
    expect(harness.ui.closeModal).not.toHaveBeenCalled();
  });
});
