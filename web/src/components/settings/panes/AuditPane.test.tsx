import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditPane } from "./AuditPane";

/** A local-time moment, so the day a row falls on does not depend on the zone. */
function local(month: number, day: number, hour: number, minute = 0): string {
  return new Date(2026, month - 1, day, hour, minute).toISOString();
}

describe("AuditPane", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 6, 20, 0));
  });

  afterEach(() => vi.useRealTimers());

  it("lists each entry with when it happened, in words for the last two days", () => {
    render(
      <AuditPane
        supported
        entries={[
          { id: "a", summary: "Maja utworzyła kanał #ogólny", at: local(8, 6, 18, 40) },
          { id: "b", summary: "Jan zbanował Olę", at: local(8, 5, 22, 15) },
          { id: "c", summary: "Jan zmienił nazwę serwera", at: local(8, 1, 9) },
        ]}
      />,
    );

    expect(screen.getByText("Maja utworzyła kanał #ogólny")).toBeVisible();
    expect(screen.getByText("dzisiaj 18:40")).toBeVisible();
    expect(screen.getByText("wczoraj 22:15")).toBeVisible();
    expect(screen.getByText("1.08.2026")).toBeVisible();
  });

  it("leaves the time blank for an entry whose date does not parse", () => {
    render(<AuditPane supported entries={[{ id: "a", summary: "Zdarzenie", at: "nonsense" }]} />);

    expect(screen.getByText("Zdarzenie").nextElementSibling).toBeEmptyDOMElement();
  });

  it("warns when the audit log is not wired to the backend", () => {
    const { rerender } = render(<AuditPane supported entries={[]} />);
    expect(screen.queryByText(/Dziennik zdarzeń nie jest jeszcze podpięty/)).toBeNull();

    rerender(<AuditPane supported={false} entries={[]} />);
    expect(screen.getByText(/Dziennik zdarzeń nie jest jeszcze podpięty/)).toBeVisible();
  });
});
