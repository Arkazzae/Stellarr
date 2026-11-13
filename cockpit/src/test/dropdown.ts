import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Opens a dropdown and picks an option, as a person does. The list is drawn in
 * <body>, outside the dialog a field may sit in, so it is looked up on the
 * screen.
 */
export async function choose(user: UserEvent, combobox: HTMLElement, option: string | RegExp): Promise<void> {
  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: option }));
}
