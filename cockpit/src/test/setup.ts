import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom computes no layout, so it cannot scroll. A dropdown that keeps its
// highlighted option in view still calls this.
Element.prototype.scrollIntoView ??= vi.fn() as unknown as Element["scrollIntoView"];

// Vitest runs without globals, so Testing Library cannot unmount between tests by itself.
afterEach(cleanup);
