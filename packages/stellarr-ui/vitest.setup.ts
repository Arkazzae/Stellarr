import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom computes no layout, so it cannot scroll. Code that keeps a keyboard
// cursor visible still calls this.
Element.prototype.scrollIntoView ??= vi.fn() as unknown as Element["scrollIntoView"];

afterEach(cleanup);
