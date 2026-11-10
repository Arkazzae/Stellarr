import { describe, expect, it } from "vitest";

import { translateMessage, type Translator } from "@/i18n";

import {
  banPerson,
  blockPerson,
  deleteChannel,
  deleteMessageConfirmation,
  kickFromChannelPerson,
  kickPerson,
  removeFriend,
} from "./confirmations";

const pl: Translator = (key, values) => translateMessage("pl", key, values);
const en: Translator = (key, values) => translateMessage("en", key, values);

describe("confirmation requests", () => {
  it("asks about a message without naming anyone", () => {
    expect(deleteMessageConfirmation(pl)).toEqual({
      title: "Usunąć tę wiadomość?",
      description: "Tego nie da się cofnąć.",
      confirmLabel: "Usuń",
      danger: true,
      icon: "trash",
    });
  });

  it.each([
    ["removeFriend", removeFriend, "Usunąć Jo ze znajomych?", "Usuń", "userAdd"],
    ["blockPerson", blockPerson, "Zablokować Jo?", "Zablokuj", "ban"],
    ["kickPerson", kickPerson, "Wyrzucić Jo?", "Wyrzuć", "signout"],
    ["kickFromChannelPerson", kickFromChannelPerson, "Rozłączyć Jo z kanału?", "Rozłącz", "signout"],
    ["deleteChannel", deleteChannel, "Usunąć kanał Jo?", "Usuń", "trash"],
  ] as const)("%s names the person and the deed", (_name, build, title, confirmLabel, icon) => {
    const request = build(pl, "Jo");

    expect(request.title).toBe(title);
    expect(request.confirmLabel).toBe(confirmLabel);
    expect(request.icon).toBe(icon);
    expect(request.danger).toBe(true);
    expect(request.description).toBeTruthy();
    expect(request.field).toBeUndefined();
  });

  it("asks for a ban reason without requiring one", () => {
    const request = banPerson(pl, "Jo");

    expect(request.title).toBe("Zbanować Jo?");
    expect(request.confirmLabel).toBe("Zbanuj");
    expect(request.danger).toBe(true);
    expect(request.field).toEqual({
      label: "POWÓD",
      placeholder: "Bez podanego powodu",
      maxLength: 200,
      optional: true,
    });
  });

  it("follows the language of the translator it is given", () => {
    expect(blockPerson(en, "Jo").title).toBe("Block Jo?");
    expect(banPerson(en, "Jo").field.label).toBe("REASON");
  });
});
