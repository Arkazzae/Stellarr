import { afterEach, describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatMegabytes,
  formatNumber,
  formatShortDateTime,
  lowerCase,
} from "./format";
import { setLocale } from "./index";

afterEach(() => setLocale("en"));

const INSTANT = "2025-03-04T10:15:30Z";

// The expected English text is built from local time, so the test holds in any time zone.
const local = new Date(INSTANT);
const pad = (value: number) => String(value).padStart(2, "0");
const day = pad(local.getDate());
const month = pad(local.getMonth() + 1);
const clock = `${pad(local.getHours())}:${pad(local.getMinutes())}`;

describe("number and size formats", () => {
  it("group digits the way the active language does", () => {
    const grouped = (locale: "pl" | "en") => {
      setLocale(locale);
      return formatNumber(1234567.5);
    };

    expect(grouped("en")).toBe("1,234,567.5");
    expect(grouped("pl")).toBe((1234567.5).toLocaleString("pl-PL"));
    expect(grouped("pl")).not.toBe(grouped("en"));
  });

  it("show megabytes with the requested precision", () => {
    expect(formatMegabytes(12.5 * 1024 * 1024, 1)).toBe("12.5 MB");
    expect(formatMegabytes(1.234 * 1024 * 1024, 2)).toBe("1.23 MB");

    setLocale("pl");

    expect(formatMegabytes(12.5 * 1024 * 1024, 1)).toBe("12,5 MB");
  });
});

describe("date formats", () => {
  it("show English dates day first on a 24-hour clock", () => {
    expect(formatDate(INSTANT)).toBe(`${day}/${month}/2025`);
    expect(formatDateTime(INSTANT)).toBe(`${day}/${month}/2025, ${clock}:30`);
    expect(formatShortDateTime(INSTANT)).toBe(`${local.getDate()} Mar 2025, ${clock}`);
  });

  it("show Polish dates as before", () => {
    setLocale("pl");

    expect(formatDate(INSTANT)).toBe(new Date(INSTANT).toLocaleDateString("pl-PL"));
    expect(formatDateTime(INSTANT)).toBe(new Date(INSTANT).toLocaleString("pl-PL"));
    expect(formatShortDateTime(INSTANT)).toBe(
      new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(INSTANT),
      ),
    );
  });
});

describe("lowerCase", () => {
  it("lower-cases Polish capitals", () => {
    setLocale("pl");

    expect(lowerCase("ŁÓDŹ")).toBe("łódź");
  });

  it("lower-cases English text", () => {
    expect(lowerCase("Server")).toBe("server");
  });
});
