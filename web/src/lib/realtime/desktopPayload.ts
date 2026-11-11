import { parseMessage } from "@/lib/api/client";
import { parseMediaSessionClosed, parseMediaSignal } from "./hubPayloads";
import type { RealtimeEventName } from "./types";

/**
 * The desktop transport relays hub arguments untouched. Message events carry
 * explicit nulls (`replyTo`, `editedAt`, `pinnedAt`) that chat state does not
 * expect, so they go through the same wire parser as the browser socket. The
 * media server's signals and closures are decoded by the same typed parsers as
 * in the browser, because the media layer acts on them without looking again.
 * Every other event is passed through as received.
 *
 * Throws when a message or media payload is malformed, so the caller can drop
 * the event.
 */
export function parseDesktopHubPayload(event: RealtimeEventName, payload: unknown): unknown {
  switch (event) {
    case "MessageCreated":
    case "DirectMessageCreated":
    case "MessageUpdated":
      return parseMessage(payload, `desktop realtime ${event}`);
    case "MediaSignal":
      return required(parseMediaSignal(payload), event);
    case "MediaSessionClosed":
      return required(parseMediaSessionClosed(payload), event);
    default:
      return payload;
  }
}

function required<T>(decoded: T | null, event: RealtimeEventName): T {
  if (decoded === null) throw new Error(`desktop realtime ${event}: malformed payload`);
  return decoded;
}
