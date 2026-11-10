import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The launch instruction is consumed once per page load, which is module state.
async function freshModule() {
  vi.resetModules();
  return import("./callPopout");
}

function openedAt(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => openedAt(""));
afterEach(() => vi.restoreAllMocks());

describe("useJoinFromPopoutLink", () => {
  it("joins the call named by a popped-out window's address", async () => {
    const { useJoinFromPopoutLink } = await freshModule();
    const join = vi.fn();
    openedAt("?popout=1&voiceChannel=ch-salon");

    renderHook(() => useJoinFromPopoutLink(join));

    expect(join).toHaveBeenCalledExactlyOnceWith("ch-salon");
  });

  it("does not dial a second time when the room mounts again", async () => {
    const { useJoinFromPopoutLink } = await freshModule();
    const join = vi.fn();
    openedAt("?popout=1&voiceChannel=ch-salon");

    renderHook(() => useJoinFromPopoutLink(join)).unmount();
    renderHook(() => useJoinFromPopoutLink(join));

    expect(join).toHaveBeenCalledOnce();
  });

  it("does not dial again when only the callback changes", async () => {
    const { useJoinFromPopoutLink } = await freshModule();
    const first = vi.fn();
    const second = vi.fn();
    openedAt("?popout=1&voiceChannel=ch-salon");

    const view = renderHook(({ join }) => useJoinFromPopoutLink(join), {
      initialProps: { join: first },
    });
    view.rerender({ join: second });

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("ignores an address that names a call but is not a popout", async () => {
    const { useJoinFromPopoutLink } = await freshModule();
    const join = vi.fn();
    openedAt("?voiceChannel=ch-salon");

    renderHook(() => useJoinFromPopoutLink(join));

    expect(join).not.toHaveBeenCalled();
  });

  it("ignores a popout address that names no call", async () => {
    const { useJoinFromPopoutLink } = await freshModule();
    const join = vi.fn();
    openedAt("?popout=1");

    renderHook(() => useJoinFromPopoutLink(join));

    expect(join).not.toHaveBeenCalled();
  });

  it("does not wait for a later address once the first room has mounted", async () => {
    const { useJoinFromPopoutLink } = await freshModule();
    const join = vi.fn();

    renderHook(() => useJoinFromPopoutLink(join));
    openedAt("?popout=1&voiceChannel=ch-salon");
    renderHook(() => useJoinFromPopoutLink(join));

    expect(join).not.toHaveBeenCalled();
  });
});

describe("popOutCall", () => {
  it("opens this page in a small window that dials the call", async () => {
    const { popOutCall } = await freshModule();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openedAt("?keep=this");

    popOutCall("ch-salon");

    const [url, name, features] = open.mock.calls[0]!;
    const opened = new URL(String(url));
    expect(opened.searchParams.get("popout")).toBe("1");
    expect(opened.searchParams.get("voiceChannel")).toBe("ch-salon");
    expect(opened.searchParams.get("keep")).toBe("this");
    expect(name).toBe("stellarr-call");
    expect(features).toMatch(/popup/);
  });
});
