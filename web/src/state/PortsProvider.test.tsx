import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetRuntime, createRuntime, getRuntime, type Runtime } from "@/adapters";
import { FakeRealtimeClient } from "@/test/fakes";
import { fullApi } from "@/test/runtime";

import { PortsProvider, usePorts, useRuntime } from "./PortsProvider";

const runtimes: Runtime[] = [];

function testRuntime(): Runtime {
  const runtime = createRuntime({ api: fullApi(), realtime: new FakeRealtimeClient() });
  runtimes.push(runtime);
  return runtime;
}

let seen: { runtime: Runtime; ports: Runtime["ports"] } | undefined;

function Capture() {
  const runtime = useRuntime();
  const ports = usePorts();
  return (
    <button type="button" onClick={() => (seen = { runtime, ports })}>
      Capture
    </button>
  );
}

afterEach(() => {
  seen = undefined;
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  __resetRuntime();
});

describe("PortsProvider", () => {
  it("publishes the runtime it is given, and its ports", () => {
    const runtime = testRuntime();
    render(
      <PortsProvider runtime={runtime}>
        <Capture />
      </PortsProvider>,
    );

    screen.getByRole("button", { name: "Capture" }).click();

    expect(seen?.runtime).toBe(runtime);
    expect(seen?.ports).toBe(runtime.ports);
  });

  it("falls back to the one runtime of the browser session", () => {
    render(
      <PortsProvider>
        <Capture />
      </PortsProvider>,
    );

    screen.getByRole("button", { name: "Capture" }).click();

    expect(seen?.runtime).toBe(getRuntime());
    runtimes.push(getRuntime());
  });

  it.each([
    ["useRuntime", () => useRuntime()],
    ["usePorts", () => usePorts()],
  ])("%s refuses to run outside the provider", (_name, hook) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Orphan() {
      hook();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow("useRuntime must be used inside <PortsProvider>");
  });
});
