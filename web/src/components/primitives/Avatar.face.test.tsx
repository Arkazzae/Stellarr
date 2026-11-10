import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { defaultIdentityArt, OFFLINE_AVATAR } from "@/design/identity";

import { Avatar, PresenceDot } from "./Avatar";

function personBg(element: Element | null): string {
  return (element as HTMLElement).style.getPropertyValue("--person-bg");
}

describe("Avatar as a face", () => {
  it("is decoration, hidden from assistive tech, when it opens nothing", () => {
    render(<Avatar id="u1" displayName="Ada Lovelace" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("prefers the precomputed initials and derives them from the name otherwise", () => {
    const { container, rerender } = render(
      <Avatar id="u1" displayName="Ada Lovelace" initials="AL" />,
    );
    expect(container.textContent).toBe("AL");

    rerender(<Avatar id="u1" displayName="grace hopper" />);
    expect(container.textContent).toBe("GH");
  });

  it("treats an empty avatar url as no upload", () => {
    const { container } = render(
      <Avatar id="u1" displayName="Ada Lovelace" avatarUrl="" />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      defaultIdentityArt("u1").avatarUrl,
    );
  });

  it("keeps the initials under the picture and keeps the picture undraggable", () => {
    const { container } = render(
      <Avatar id="u1" displayName="Ada Lovelace" avatarUrl="/uploads/ada.webp" />,
    );

    expect(container.textContent).toBe("AL");
    expect(container.querySelector("img")).toHaveAttribute("draggable", "false");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});

describe("Avatar as a control", () => {
  it("is a button named after the person and hands its element to the handler", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Avatar id="u1" displayName="Ada Lovelace" onOpen={onOpen} />);

    const button = screen.getByRole("button", { name: "Profil: Ada Lovelace" });
    await user.click(button);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(button);
  });

  it("takes a custom accessible name", () => {
    render(
      <Avatar id="u1" displayName="Ada Lovelace" onOpen={() => {}} label="Otwórz kartę" />,
    );

    expect(screen.getByRole("button", { name: "Otwórz kartę" })).toBeInTheDocument();
  });
});

describe("Avatar colour", () => {
  it("loses its hue for an offline person", () => {
    const { container } = render(
      <Avatar id="u1" displayName="Ada Lovelace" presence="offline" />,
    );

    expect(personBg(container.firstElementChild)).toBe(OFFLINE_AVATAR);
  });

  it("lets an explicit offline flag override the presence", () => {
    const { container, rerender } = render(
      <Avatar id="u1" displayName="Ada Lovelace" presence="offline" offline={false} />,
    );
    const hued = personBg(container.firstElementChild);
    expect(hued).not.toBe(OFFLINE_AVATAR);

    rerender(<Avatar id="u1" displayName="Ada Lovelace" presence="online" offline />);
    expect(personBg(container.firstElementChild)).toBe(OFFLINE_AVATAR);
  });

  it("gives a system notice the neutral disc whatever its id", () => {
    const { container } = render(
      <Avatar id="system" displayName="System" system />,
    );

    expect(personBg(container.firstElementChild)).toBe("var(--info-line)");
  });
});

describe("Avatar status", () => {
  it("shows a status dot only when given a presence", () => {
    const { container, rerender } = render(
      <Avatar id="u1" displayName="Ada Lovelace" />,
    );
    expect(container.querySelector(".pdot")).toBeNull();

    rerender(<Avatar id="u1" displayName="Ada Lovelace" presence="dnd" />);
    expect(container.querySelector(".pdot.dnd")).not.toBeNull();
  });

  it("marks the speaking and dimmed states on the face", () => {
    const { container } = render(
      <Avatar id="u1" displayName="Ada Lovelace" speaking dim />,
    );

    expect(container.firstElementChild).toHaveClass("speaking", "dim");
  });

  it("renders the dot on its own, hidden from assistive tech", () => {
    const { container } = render(<PresenceDot presence="idle" className="beside" />);

    expect(container.firstElementChild).toHaveClass("pdot", "idle", "beside");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
