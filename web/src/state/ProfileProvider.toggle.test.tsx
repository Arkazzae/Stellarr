import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProfileProvider, useProfileContext } from "./ProfileProvider";

function Probe() {
  const profile = useProfileContext();
  return (
    <div>
      <button type="button" onClick={(event) => profile.toggle("ada", event.currentTarget)}>
        Ada
      </button>
      <button type="button" onClick={(event) => profile.toggle("grace", event.currentTarget)}>
        Grace
      </button>
      <button type="button" onClick={profile.close}>
        Close
      </button>
      <output aria-label="open">{profile.open?.userId ?? "closed"}</output>
      <output aria-label="anchor">{profile.open?.anchor.textContent ?? "none"}</output>
    </div>
  );
}

function setup() {
  render(
    <ProfileProvider>
      <Probe />
    </ProfileProvider>,
  );
  return userEvent.setup();
}

const open = () => screen.getByLabelText("open");
const button = (name: string) => screen.getByRole("button", { name });

describe("ProfileProvider", () => {
  it("opens the card for the person whose control was used", async () => {
    const user = setup();

    await user.click(button("Ada"));

    expect(open()).toHaveTextContent("ada");
  });

  it("closes the card when the same control is used again", async () => {
    const user = setup();

    await user.click(button("Ada"));
    await user.click(button("Ada"));

    expect(open()).toHaveTextContent("closed");
  });

  it("moves the card to another person's control instead of closing it", async () => {
    const user = setup();

    await user.click(button("Ada"));
    await user.click(button("Grace"));

    expect(open()).toHaveTextContent("grace");
  });

  it("closes on request", async () => {
    const user = setup();
    await user.click(button("Ada"));

    await user.click(button("Close"));

    expect(open()).toHaveTextContent("closed");
  });

  it("hangs the card off the element that opened it", async () => {
    const user = setup();

    await user.click(button("Grace"));

    expect(screen.getByLabelText("anchor")).toHaveTextContent("Grace");
  });

  it("refuses to run outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Probe />)).toThrow("useProfile must be used inside <ProfileProvider>");
  });
});
