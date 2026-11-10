import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage } from "@/i18n";

import { AuditPane } from "./AuditPane";

vi.mock("@/state/hooks", () => ({
  useLanguage: () => ({
    locale: "en",
    t: (key: Parameters<typeof translateMessage>[1], values?: Record<string, string | number>) =>
      translateMessage("en", key, values),
  }),
}));

describe("AuditPane in English", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 6, 20, 0));
  });

  afterEach(() => vi.useRealTimers());

  it("words the last two days and writes older dates the English way", () => {
    render(
      <AuditPane
        supported
        entries={[
          { id: "a", summary: "Maja created #general", at: new Date(2026, 7, 6, 18, 40).toISOString() },
          { id: "b", summary: "Jan banned Ola", at: new Date(2026, 7, 5, 22, 15).toISOString() },
          { id: "c", summary: "Jan renamed the server", at: new Date(2026, 7, 1, 9).toISOString() },
        ]}
      />,
    );

    expect(screen.getByText("today 18:40")).toBeVisible();
    expect(screen.getByText("yesterday 22:15")).toBeVisible();
    expect(screen.getByText("1/08/2026")).toBeVisible();
  });
});
