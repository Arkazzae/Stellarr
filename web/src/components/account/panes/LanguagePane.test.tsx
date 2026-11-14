import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage } from "@/i18n";

import { LanguagePane } from "./LanguagePane";

const model = vi.hoisted(() => ({
  state: { status: "not-downloaded", sizeMb: 22 },
  download: vi.fn(async () => undefined),
  check: vi.fn(async () => undefined),
}));

vi.mock("@/lib/chatTranslation/useModelStatus", () => ({
  useModelStatus: () => model,
}));

describe("LanguagePane", () => {
  beforeEach(() => {
    model.state = { status: "not-downloaded", sizeMb: 22 };
    model.download.mockClear();
    model.check.mockClear();
  });

  it("downloads a missing model after translation is enabled", async () => {
    const update = vi.fn();
    render(
      <LanguagePane
        locale="pl"
        chatTranslationEnabled
        chatAutoTranslateEnabled={false}
        chatTranslationTargetLanguage="en"
        update={update}
        t={(key, values) => translateMessage("pl", key, values)}
      />,
    );

    await waitFor(() => expect(model.download).toHaveBeenCalledOnce());
    expect(screen.getByText(/22 MB/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Tłumacz automatycznie" }))
      .toBeDisabled();

    await userEvent.click(screen.getAllByRole("radio", { name: /English/ })[0]!);
    expect(update).toHaveBeenCalledWith({ locale: "en" });
  });

  it("shows how the chosen language writes a date, and moves through the list with the arrows", async () => {
    const update = vi.fn();
    render(
      <LanguagePane
        locale="pl"
        chatTranslationEnabled={false}
        chatAutoTranslateEnabled={false}
        chatTranslationTargetLanguage="en"
        update={update}
        t={(key, values) => translateMessage("pl", key, values)}
      />,
    );

    const list = screen.getByRole("radiogroup", { name: "Język interfejsu" });
    const polish = within(list).getByRole("radio", { name: /Polski/ });
    const written = new Intl.DateTimeFormat("pl", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(2026, 10, 14, 19, 4));
    expect(polish).toHaveTextContent(written);
    // The other row names its language in the interface's tongue instead.
    expect(within(list).getByRole("radio", { name: /English/ })).toHaveTextContent("Angielski");
    // Two languages read at a glance; there is nothing to search.
    expect(screen.queryByRole("searchbox")).toBeNull();

    polish.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(update).toHaveBeenCalledWith({ locale: "en" });
  });

  it("allows auto-translation only after the model is ready", async () => {
    const update = vi.fn();
    model.state = { status: "ready", sizeMb: 22 };
    render(
      <LanguagePane
        locale="en"
        chatTranslationEnabled
        chatAutoTranslateEnabled={false}
        chatTranslationTargetLanguage="en"
        update={update}
        t={(key, values) => translateMessage("en", key, values)}
      />,
    );

    const auto = screen.getByRole("switch", { name: "Translate automatically" });
    expect(auto).toBeEnabled();
    await userEvent.click(auto);
    expect(update).toHaveBeenCalledWith({ chatAutoTranslateEnabled: true });
  });
});
