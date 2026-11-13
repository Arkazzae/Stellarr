import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

function Areas({ onValueChange }: { onValueChange?: (value: string) => void }) {
  return (
    <Tabs defaultValue="users" onValueChange={onValueChange}>
      <TabsList aria-label="Areas">
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="sessions">Sessions</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>
      <TabsContent value="users">User list</TabsContent>
      <TabsContent value="sessions">Session list</TabsContent>
      <TabsContent value="roles">Role list</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("mounts only the picked panel, named by its tab", () => {
    render(<Areas />);

    const users = screen.getByRole("tab", { name: "Users" });
    expect(users).toHaveAttribute("aria-selected", "true");
    expect(users).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Roles" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Users" }).textContent).toBe("User list");
    expect(screen.queryByText("Role list")).toBeNull();
  });

  it("switches on a click", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Areas onValueChange={onValueChange} />);

    await user.click(screen.getByRole("tab", { name: "Roles" }));

    expect(onValueChange).toHaveBeenCalledWith("roles");
    expect(screen.getByRole("tabpanel").textContent).toBe("Role list");
  });

  it("is one tab stop, and the arrows move along the row and pick", async () => {
    const user = userEvent.setup();
    render(<Areas />);

    await user.tab();
    expect(screen.getByRole("tab", { name: "Users" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveFocus();
    expect(screen.getByRole("tabpanel").textContent).toBe("Session list");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Roles" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Users" })).toHaveAttribute("aria-selected", "true");

    // From the tab, Tab goes into the panel rather than along the row.
    await user.tab();
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });

  it("leaves the look to the caller when unstyled", () => {
    render(
      <Tabs unstyled defaultValue="a" className="strip">
        <TabsList unstyled className="row">
          <TabsTrigger unstyled value="a" className="pill">
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(screen.getByRole("tab").className).toBe("pill");
    expect(screen.getByRole("tablist").className).toBe("row");
  });
});
