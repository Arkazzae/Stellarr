import { parseMessage } from "@/lib/api/client";
import type { RealtimeEventName } from "./types";

/**
 * The desktop transport relays hub arguments untouched. Message events carry
 * explicit nulls (`replyTo`, `editedAt`, `pinnedAt`) that chat state does not
 * expect, so they go through the same wire parser as the browser socket. Every
 * other event is passed through as received.
 *
 * Throws when a message payload is malformed, so the caller can drop the event.
 */
export function parseDesktopHubPayload(event: RealtimeEventName, payload: unknown): unknown {
  switch (event) {
    case "MessageCreated":
    case "DirectMessageCreated":
    case "MessageUpdated":
      return parseMessage(payload, `desktop realtime ${event}`);
    default:
      return payload;
  }
}
