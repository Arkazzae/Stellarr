import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsSection } from "./SettingsSection";

describe("SettingsSection", () => {
  it("is a region named after its title, holding its body", () => {
    render(
      <SettingsSection title="Uprawnienia" icon="shield">
        <p>Treść</p>
      </SettingsSection>,
    );

    const region = screen.getByRole("region", { name: "Uprawnienia" });
    expect(within(region).getByText("Treść")).toBeInTheDocument();
  });

  it("shows a count badge, including zero, with its own accessible name", () => {
    render(
      <SettingsSection title="Role" icon="shield" count={0} countLabel="Liczba ról">
        <p>Treść</p>
      </SettingsSection>,
    );

    expect(screen.getByLabelText("Liczba ról")).toHaveTextContent("0");
  });

  it("leaves the badge out when there is no count", () => {
    render(
      <SettingsSection title="Role" icon="shield" countLabel="Liczba ról">
        <p>Treść</p>
      </SettingsSection>,
    );

    expect(screen.queryByLabelText("Liczba ról")).toBeNull();
  });

  it("puts the action in the header, not the body", () => {
    render(
      <SettingsSection title="Role" icon="shield" action={<button type="button">Dodaj</button>}>
        <p>Treść</p>
      </SettingsSection>,
    );

    const region = screen.getByRole("region", { name: "Role" });
    expect(within(region).getByRole("button", { name: "Dodaj" }).closest("header")).not.toBeNull();
  });

  it("passes the extra classes to the card and to the body", () => {
    render(
      <SettingsSection
        title="Usuń"
        icon="trash"
        className="danger-section"
        bodyClassName="ch-settings-form"
      >
        <p>Treść</p>
      </SettingsSection>,
    );

    const region = screen.getByRole("region", { name: "Usuń" });
    expect(region).toHaveClass("settings-section", "danger-section");
    expect(screen.getByText("Treść").parentElement).toHaveClass("sc-b", "ch-settings-form");
  });
});
