import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LegacyPwaCleanup } from "./LegacyPwaCleanup";

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

function stubServiceWorker(getRegistrations: () => Promise<unknown[]>) {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistrations },
    configurable: true,
  });
}

afterEach(() => {
  if (originalServiceWorker === undefined) Reflect.deleteProperty(navigator, "serviceWorker");
  else Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
});

describe("LegacyPwaCleanup", () => {
  it("unregisters old workers once when it mounts and renders nothing", async () => {
    const unregister = vi.fn(async () => true);
    stubServiceWorker(async () => [{ unregister }]);

    const { container, rerender } = render(<LegacyPwaCleanup />);
    rerender(<LegacyPwaCleanup />);

    await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    expect(container).toBeEmptyDOMElement();
  });

  it("does not leave a rejection behind when the browser refuses the cleanup", async () => {
    const getRegistrations = vi.fn(async () => {
      throw new Error("blocked");
    });
    stubServiceWorker(getRegistrations);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      render(<LegacyPwaCleanup />);
      await waitFor(() => expect(getRegistrations).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });
});
