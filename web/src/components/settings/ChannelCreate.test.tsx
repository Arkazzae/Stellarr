import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChannelCreate, type ChannelCreateProps } from "./ChannelCreate";

type User = ReturnType<typeof userEvent.setup>;

function props(overrides: Partial<ChannelCreateProps> = {}): ChannelCreateProps {
  return {
    open: true,
    onClose: vi.fn(),
    kind: "text",
    serverName: "Orbit",
    supported: true,
    sections: [],
    channels: [
      { id: "general", name: "general", kind: "text" },
      { id: "lounge", name: "lounge", kind: "voice" },
    ],
    onCreate: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const nameField = () => screen.getByRole("textbox", { name: "Nazwa" });
const create = (user: User) => user.click(screen.getByRole("button", { name: "Utwórz kanał" }));
const moveTo = (user: User, group: string) =>
  user.click(screen.getByRole("button", { name: `Przenieś nowy kanał do grupy ${group}` }));
/** The group of the rail slice the new row sits in. */
const rowGroup = () => nameField().closest(".ch-place-group") as HTMLElement;
const rowNames = (group: HTMLElement) =>
  [...group.querySelectorAll(".ch-place-row")].map(
    (row) => row.querySelector("input")?.value ?? row.querySelector(".ch-place-name")?.textContent,
  );

describe("ChannelCreate", () => {
  it("waits for persistence before closing and prevents duplicate submissions", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onCreate = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const onClose = vi.fn();
    render(<ChannelCreate {...props({ onCreate, onClose })} />);

    await user.type(nameField(), "Nowy Kanał");
    await create(user);

    expect(onCreate).toHaveBeenCalledWith({ name: "nowy-kanał", kind: "text" });
    expect(screen.getByRole("button", { name: "Tworzenie…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zamknij" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Tworzenie…" }));
    expect(onCreate).toHaveBeenCalledOnce();

    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("creates with Enter and keeps the row open to explain a refusal", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error("Kanał o tej nazwie już istnieje."));
    const onClose = vi.fn();
    render(<ChannelCreate {...props({ kind: "voice", onCreate, onClose })} />);

    await user.type(nameField(), "Salon{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Kanał o tej nazwie już istnieje.");
    expect(nameField()).toHaveValue("Salon");
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("switches the kind with the row's own mark, which moves it to the other group", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve());
    render(<ChannelCreate {...props({ onCreate })} />);
    expect(rowGroup()).toHaveTextContent("Tekstowe");

    await user.click(screen.getByRole("button", { name: "Zmień na kanał głosowy" }));

    expect(rowGroup()).toHaveTextContent("Głosowe");
    expect(screen.getByRole("button", { name: "Zmień na kanał tekstowy" })).toHaveFocus();
    await user.type(nameField(), "Salon");
    await create(user);
    expect(onCreate).toHaveBeenCalledWith({ name: "salon", kind: "voice" });
  });

  it("takes the kind of the group the + carries it to", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve());
    render(<ChannelCreate {...props({ onCreate })} />);

    await moveTo(user, "Głosowe");

    expect(rowGroup()).toHaveTextContent("Głosowe");
    expect(nameField()).toHaveFocus();
    await user.keyboard("radio{Enter}");
    expect(onCreate).toHaveBeenCalledWith({ name: "radio", kind: "voice" });
  });

  it("joins a section after its text channels and keeps its kind there", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve());
    render(
      <ChannelCreate
        {...props({
          onCreate,
          sections: [{ id: "sec-1", name: "Ogłoszenia" }],
          channels: [
            { id: "general", name: "general", kind: "text" },
            { id: "radio", name: "radio", kind: "voice", sectionId: "sec-1" },
            { id: "plan", name: "plan", kind: "text", sectionId: "sec-1" },
          ],
        })}
      />,
    );

    await moveTo(user, "Ogłoszenia");
    await user.type(nameField(), "ważne");

    expect(rowNames(rowGroup())).toEqual(["plan", "ważne", "radio"]);
    await create(user);
    expect(onCreate).toHaveBeenCalledWith({ name: "ważne", kind: "text", sectionId: "sec-1" });
  });
});
