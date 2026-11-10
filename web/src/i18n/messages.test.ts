import { describe, expect, it } from "vitest";

import { en } from "./messages/en";
import { pl } from "./messages/pl";
import { translateMessage } from ".";

describe("interface message catalogs", () => {
  it("keeps every locale on the same set of keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
  });

  it("interpolates named values without evaluating message content", () => {
    expect(translateMessage("en", "language.model.preparing", { size: 22 }))
      .toBe("Preparing a 22 MB local model…");
  });
});

