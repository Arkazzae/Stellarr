import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutMode, useMediaQuery } from "./useMediaQuery";

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.innerWidth = originalInnerWidth;
});

/** A matchMedia whose answer a test can flip, notifying whoever listens. */
function controllableMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  let matches = initial;
  const addEventListener = vi.fn((_type: string, listener: () => void) => {
    listeners.add(listener);
  });
  const removeEventListener = vi.fn((_type: string, listener: () => void) => {
    listeners.delete(listener);
  });
  window.matchMedia = vi.fn((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener,
    removeEventListener,
  })) as unknown as typeof window.matchMedia;

  return {
    listeners,
    removeEventListener,
    set(value: boolean) {
      matches = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("useMediaQuery", () => {
  it("answers the server value when rendered on the server", () => {
    function Probe({ serverValue }: { serverValue: boolean }) {
      return <>{String(useMediaQuery("(min-width: 5000px)", serverValue))}</>;
    }

    expect(renderToString(<Probe serverValue={true} />)).toBe("true");
    expect(renderToString(<Probe serverValue={false} />)).toBe("false");
  });

  it("answers the real match on the client, whatever the server value", () => {
    controllableMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)", true));

    expect(result.current).toBe(false);
  });

  it("follows the query as it starts and stops matching", () => {
    const media = controllableMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)", false));
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it("stops listening when unmounted", () => {
    const media = controllableMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 768px)", true));
    expect(media.listeners.size).toBe(1);

    unmount();

    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(media.listeners.size).toBe(0);
  });

  it("re-reads the answer when the query changes", () => {
    window.matchMedia = vi.fn((query: string) => ({
      media: query,
      matches: query === "(max-width: 600px)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { result, rerender } = renderHook(
      ({ query }) => useMediaQuery(query, false),
      { initialProps: { query: "(min-width: 600px)" } },
    );
    expect(result.current).toBe(false);

    rerender({ query: "(max-width: 600px)" });

    expect(result.current).toBe(true);
  });
});

describe("useLayoutMode", () => {
  it.each([
    { width: 500, railOverlay: true, rosterOverlay: true },
    { width: 767, railOverlay: true, rosterOverlay: true },
    { width: 768, railOverlay: false, rosterOverlay: true },
    { width: 1199, railOverlay: false, rosterOverlay: true },
    { width: 1200, railOverlay: false, rosterOverlay: false },
  ])(
    "overlays rail $railOverlay and roster $rosterOverlay at $width px",
    ({ width, ...expected }) => {
      window.innerWidth = width;

      const { result } = renderHook(() => useLayoutMode());

      expect(result.current).toEqual(expected);
    },
  );

  it("renders the wide layout on the server", () => {
    window.innerWidth = 500;
    function Probe() {
      const { railOverlay, rosterOverlay } = useLayoutMode();
      return <>{`${railOverlay}/${rosterOverlay}`}</>;
    }

    expect(renderToString(<Probe />)).toBe("false/false");
  });
});
