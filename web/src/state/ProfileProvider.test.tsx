import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { ProfileProvider, useProfileContext } from "./ProfileProvider";

function Probe() {
  const profile = useProfileContext();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          if (trigger.current !== null) {
            profile.toggle("ada", trigger.current);
          }
        }}
      >
        Profil Ady
      </button>
      <output aria-label="autofocus">
        {profile.open === null
          ? "closed"
          : profile.open.autoFocus
            ? "yes"
            : "no"}
      </output>
    </>
  );
}

function setup() {
  render(
    <ProfileProvider>
      <Probe />
    </ProfileProvider>,
  );
  return screen.getByRole("button", { name: "Profil Ady" });
}

describe("ProfileProvider input modality", () => {
  it("keeps autofocus off after a touch opening", () => {
    const trigger = setup();

    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger, { detail: 1 });

    expect(screen.getByLabelText("autofocus")).toHaveTextContent("no");
  });

  it("keeps autofocus for keyboard opening", () => {
    const trigger = setup();

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger, { detail: 0 });

    expect(screen.getByLabelText("autofocus")).toHaveTextContent("yes");
  });
});
