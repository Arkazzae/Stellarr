import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntime, type Runtime } from "@/adapters";
import { BOOTSTRAP, FakeRealtimeClient, SELF } from "@/test/fakes";
import { fullApi, type FullApi } from "@/test/runtime";

import { AccountProvider, useAccountContext } from "./AccountProvider";
import { PortsProvider } from "./PortsProvider";

function Probe() {
  const value = useAccountContext();
  return (
    <div>
      <output aria-label="name">{value.account.displayName}</output>
      <output aria-label="avatar">{value.account.avatarUrl ?? "none"}</output>
      <output aria-label="banner">{value.account.bannerUrl ?? "none"}</output>
      <output aria-label="reduced-motion">{String(value.preferences.reducedMotion)}</output>
      <button type="button" onClick={() => void value.update({ displayName: "Maja K." })}>
        Rename
      </button>
      <button type="button" onClick={() => void value.setPreferences({ reducedMotion: true })}>
        Reduce motion
      </button>
      <button
        type="button"
        onClick={() => void value.setImage("avatar", new File(["x"], "me.png", { type: "image/png" }))}
      >
        Upload avatar
      </button>
      <button type="button" onClick={() => void value.removeImage("banner")}>
        Remove banner
      </button>
    </div>
  );
}

const runtimes: Runtime[] = [];

async function mount(api: FullApi = fullApi()) {
  const runtime = createRuntime({ api, realtime: new FakeRealtimeClient() });
  runtimes.push(runtime);
  await runtime.hydrate({ ...BOOTSTRAP, members: [SELF] });
  const view = render(
    <PortsProvider runtime={runtime}>
      <AccountProvider>
        <Probe />
      </AccountProvider>
    </PortsProvider>,
  );
  return { runtime, api, ...view };
}

afterEach(() => {
  act(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });
});

describe("AccountProvider", () => {
  it("shows the hydrated account", async () => {
    await mount();

    expect(screen.getByLabelText("name")).toHaveTextContent(SELF.displayName);
  });

  it("sends a profile edit through the port and shows the answer", async () => {
    const api = fullApi();
    await mount(api);

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(screen.getByLabelText("name")).toHaveTextContent("Maja K."));
    expect(api.updateAccount).toHaveBeenCalledWith({ displayName: "Maja K." });
  });

  it("uploads a picture and shows the address the server gave it", async () => {
    const api = fullApi();
    await mount(api);

    await userEvent.click(screen.getByRole("button", { name: "Upload avatar" }));

    await waitFor(() => expect(screen.getByLabelText("avatar")).toHaveTextContent("/assets/avatar"));
    expect(api.uploadAccountImage).toHaveBeenCalledWith("avatar", expect.any(File));
  });

  it("removes a picture with a request of its own", async () => {
    const api = fullApi();
    await mount(api);

    await userEvent.click(screen.getByRole("button", { name: "Remove banner" }));

    await waitFor(() => expect(api.removeAccountImage).toHaveBeenCalledWith("banner"));
  });

  it("marks the document while reduced motion is on, and clears it on unmount", async () => {
    const { unmount } = await mount();
    expect(document.documentElement.dataset.reducedMotion).toBeUndefined();

    await userEvent.click(screen.getByRole("button", { name: "Reduce motion" }));
    await waitFor(() => expect(document.documentElement.dataset.reducedMotion).toBe("true"));
    expect(screen.getByLabelText("reduced-motion")).toHaveTextContent("true");

    unmount();
    expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
  });

  it("refuses to run outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Probe />)).toThrow("useAccount must be used inside <AccountProvider>");
  });
});
