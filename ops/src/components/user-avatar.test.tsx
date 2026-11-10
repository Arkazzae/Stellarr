import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "@/components/user-avatar";
import { defaultAvatarUrl } from "@/lib/identity-art";

function renderAvatar(props: { displayName: string; avatarUrl: string | null }) {
  const { container } = render(<UserAvatar id="user-1" {...props} />);
  return { text: container.textContent, image: container.querySelector("img") };
}

describe("UserAvatar", () => {
  it("shows the uploaded picture when there is one", () => {
    const { image } = renderAvatar({ displayName: "Ola Owner", avatarUrl: "/media/ola.png" });

    expect(image?.getAttribute("src")).toBe("/media/ola.png");
  });

  it.each([null, ""])("falls back to the default picture for the id when avatarUrl is %j", (avatarUrl) => {
    const { image } = renderAvatar({ displayName: "Ola Owner", avatarUrl });

    expect(image?.getAttribute("src")).toBe(defaultAvatarUrl("user-1"));
  });

  it("uses the first letters of the first two words as initials", () => {
    expect(renderAvatar({ displayName: "Ola Maria Owner", avatarUrl: null }).text).toBe("OM");
    expect(renderAvatar({ displayName: "Ola", avatarUrl: null }).text).toBe("O");
  });
});
