import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playSystemFx, stopSystemFx } from "@/lib/audio/systemFx";
import type { AndroidCallBridge } from "@/lib/android/callBridge";
import {
  closeIncomingCallNotification,
  showIncomingCallNotification,
} from "@/lib/notifications/browser";
import type { DmConversation } from "@/ports";
import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { IncomingCallContainer } from "./IncomingCallContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);
vi.mock("@/lib/audio/systemFx", () => ({
  playSystemFx: vi.fn(),
  stopSystemFx: vi.fn(),
}));
vi.mock("@/lib/notifications/browser", () => ({
  showIncomingCallNotification: vi.fn(async () => true),
  closeIncomingCallNotification: vi.fn(async () => {}),
}));

const BODY = "Dzwoni do Ciebie. Odbierz w Stellarr.";

/** A direct conversation in which the other person is in the room. */
function ringing(callId = "call-1"): DmConversation {
  return {
    id: "dm-ola",
    peer: { id: "u-ola", username: "ola", displayName: "Ola", presence: "online" },
    unread: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    callId,
    callParticipants: [{ userId: "u-ola" } as never],
  };
}

function setConversations(...conversations: DmConversation[]) {
  setStubs({ friends: { conversations } });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function installBridge(overrides: Partial<AndroidCallBridge> = {}) {
  const spies = {
    notificationPermission: vi.fn(() => "granted"),
    requestNotificationPermission: vi.fn(),
    showIncomingCall: vi.fn(),
    hideIncomingCall: vi.fn(),
    consumeCallAction: vi.fn(() => ""),
  };
  window.StellarrAndroidCall = {
    notificationsSupported: () => true,
    ...spies,
    ...overrides,
  };
  return spies;
}

function nativeAction(action: "answer" | "decline", callId = "call-1") {
  return JSON.stringify({ action, conversationId: "dm-ola", callId });
}

beforeEach(() => {
  resetStubs();
  vi.clearAllMocks();
});

afterEach(() => {
  delete window.StellarrAndroidCall;
  setVisibility("visible");
});

describe("IncomingCallContainer", () => {
  describe("in a browser", () => {
    it("rings and offers the call while the other person is in the room", () => {
      setConversations(ringing());
      render(<IncomingCallContainer />);

      expect(screen.getByRole("dialog", { name: "Połączenie od Ola" })).toBeInTheDocument();
      expect(playSystemFx).toHaveBeenCalledWith("calling");
    });

    it("stays quiet when nobody is calling", () => {
      setConversations({ ...ringing(), callParticipants: undefined, callId: undefined });
      render(<IncomingCallContainer />);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(playSystemFx).not.toHaveBeenCalled();
    });

    it("does not ring for a room only you are in", () => {
      setConversations({ ...ringing(), callParticipants: [{ userId: "u-maja" } as never] });
      render(<IncomingCallContainer />);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(playSystemFx).not.toHaveBeenCalled();
    });

    it("does not ring for the room you are already in", () => {
      setConversations(ringing());
      setStubs({ voice: { channelId: "dm-ola" } });
      render(<IncomingCallContainer />);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(playSystemFx).not.toHaveBeenCalled();
    });

    it("keeps ringing after answer until the call is joined", async () => {
      const user = userEvent.setup();
      setConversations(ringing());
      const { rerender } = render(<IncomingCallContainer />);

      await user.click(screen.getByRole("button", { name: "Odbierz" }));
      expect(stubs.friends.callConversation).toHaveBeenCalledWith("dm-ola");
      expect(stopSystemFx).not.toHaveBeenCalledWith("calling");

      setStubs({ voice: { channelId: "dm-ola" } });
      rerender(<IncomingCallContainer />);

      expect(stopSystemFx).toHaveBeenCalledWith("calling");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("stops ringing at once on decline, though the room is still occupied", async () => {
      const user = userEvent.setup();
      setConversations(ringing());
      render(<IncomingCallContainer />);

      await user.click(screen.getByRole("button", { name: "Odrzuć" }));

      expect(stubs.friends.declineCall).toHaveBeenCalledWith("dm-ola");
      expect(stopSystemFx).toHaveBeenCalledWith("calling");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("rings again for a new call after one was declined", async () => {
      const user = userEvent.setup();
      setConversations(ringing("call-1"));
      const { rerender } = render(<IncomingCallContainer />);
      await user.click(screen.getByRole("button", { name: "Odrzuć" }));

      setConversations(ringing("call-2"));
      rerender(<IncomingCallContainer />);

      expect(screen.getByRole("dialog", { name: "Połączenie od Ola" })).toBeInTheDocument();
    });

    it("stops ringing when the caller hangs up", () => {
      setConversations(ringing());
      const { rerender } = render(<IncomingCallContainer />);
      vi.mocked(stopSystemFx).mockClear();

      setConversations({ ...ringing(), callParticipants: [], callId: undefined });
      rerender(<IncomingCallContainer />);

      expect(stopSystemFx).toHaveBeenCalledWith("calling");
    });

    it("raises a system notification only while the page is hidden", () => {
      setConversations(ringing());
      render(<IncomingCallContainer />);
      expect(showIncomingCallNotification).not.toHaveBeenCalled();

      setVisibility("hidden");
      expect(showIncomingCallNotification).toHaveBeenCalledWith({
        id: "call-1",
        caller: "Ola",
        body: BODY,
      });

      setVisibility("visible");
      expect(closeIncomingCallNotification).toHaveBeenCalledWith("call-1");
    });

    it("raises none when the account turned system notifications off", () => {
      setStubs({
        account: {
          preferences: { ...stubs.account.preferences, desktopNotifications: false },
        },
      });
      setConversations(ringing());
      setVisibility("hidden");
      render(<IncomingCallContainer />);

      expect(showIncomingCallNotification).not.toHaveBeenCalled();
    });
  });

  describe("inside the Android shell", () => {
    it("hands the ring to the native notification and plays no sound of its own", () => {
      const bridge = installBridge();
      setConversations(ringing());
      render(<IncomingCallContainer />);

      expect(bridge.showIncomingCall).toHaveBeenCalledWith("dm-ola", "call-1", "Ola", BODY);
      expect(playSystemFx).not.toHaveBeenCalledWith("calling");
      expect(showIncomingCallNotification).not.toHaveBeenCalled();
    });

    it("takes the notification down when the call ends", () => {
      const bridge = installBridge();
      setConversations(ringing());
      const { unmount } = render(<IncomingCallContainer />);

      unmount();

      expect(bridge.hideIncomingCall).toHaveBeenCalledWith("call-1");
    });

    it("shows no notification when the account turned them off", () => {
      const bridge = installBridge();
      setStubs({
        account: {
          preferences: { ...stubs.account.preferences, desktopNotifications: false },
        },
      });
      setConversations(ringing());
      render(<IncomingCallContainer />);

      expect(bridge.showIncomingCall).not.toHaveBeenCalled();
    });

    it("asks for the notification permission once the shell is visible", () => {
      const bridge = installBridge({ notificationPermission: vi.fn(() => "default") });
      render(<IncomingCallContainer />);

      expect(bridge.requestNotificationPermission).toHaveBeenCalledTimes(1);
    });

    it("answers a tap on the notification", () => {
      const bridge = installBridge();
      setConversations(ringing());
      render(<IncomingCallContainer />);

      bridge.consumeCallAction.mockReturnValueOnce(nativeAction("answer"));
      act(() => {
        window.dispatchEvent(new Event("stellarr:android-call-action"));
      });

      expect(stubs.friends.callConversation).toHaveBeenCalledWith("dm-ola");
      expect(bridge.hideIncomingCall).toHaveBeenCalledWith("call-1");
    });

    it("declines from the notification and hides the banner", () => {
      const bridge = installBridge();
      setConversations(ringing());
      render(<IncomingCallContainer />);

      bridge.consumeCallAction.mockReturnValueOnce(nativeAction("decline"));
      act(() => {
        window.dispatchEvent(new Event("stellarr:android-call-action"));
      });

      expect(stubs.friends.declineCall).toHaveBeenCalledWith("dm-ola");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("keeps a tap from a cold launch until the call shows up, then acts once", () => {
      const bridge = installBridge({ consumeCallAction: vi.fn(() => nativeAction("answer")) });
      const { rerender } = render(<IncomingCallContainer />);
      expect(stubs.friends.callConversation).not.toHaveBeenCalled();

      setConversations(ringing());
      rerender(<IncomingCallContainer />);
      // Any later change to the social state must not replay the tap.
      setStubs({ friends: { unread: 1 } });
      rerender(<IncomingCallContainer />);

      expect(stubs.friends.callConversation).toHaveBeenCalledTimes(1);
      expect(bridge.hideIncomingCall).toHaveBeenCalledWith("call-1");
    });
  });
});
