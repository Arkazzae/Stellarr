import { translateMessage, type Translator } from "@/i18n";

/** A catalog as a translator, for tests that hand one to the code under test. */
export const polish: Translator = (key, values) => translateMessage("pl", key, values);
export const english: Translator = (key, values) => translateMessage("en", key, values);
