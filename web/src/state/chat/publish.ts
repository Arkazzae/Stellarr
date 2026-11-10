import type {
  Attachment,
  Message,
  MessageReference,
  SendMessage,
  User,
} from "@/ports";

/** A send that failed, remembered so that an identical retry is recognisable. */
export interface FailedPublish {
  fingerprint: string;
  clientMessageId: string;
}

/** What makes two sends the same send: where, what, with which files, to whom. */
export function publishFingerprint(
  channelId: string,
  text: string,
  attachments: readonly Attachment[],
  answering: MessageReference | null,
): string {
  return JSON.stringify([
    channelId,
    text,
    attachments.map((attachment) => attachment.id),
    answering?.id ?? null,
  ]);
}

/**
 * The idempotency key a send travels under. A retry of the send that just
 * failed reuses its key, so a first attempt that actually landed is not
 * posted a second time.
 */
export function clientIdFor(
  failed: FailedPublish | null,
  fingerprint: string,
): string {
  return failed?.fingerprint === fingerprint
    ? failed.clientMessageId
    : crypto.randomUUID();
}

/** Forgets a failure once the send it belongs to went through. */
export function clearFailed(
  failed: FailedPublish | null,
  clientMessageId: string,
): FailedPublish | null {
  return failed?.clientMessageId === clientMessageId ? null : failed;
}

interface Outgoing {
  channelId: string;
  text: string;
  attachments: readonly Attachment[];
  answering: MessageReference | null;
  clientMessageId: string;
}

/** The message as it shows while the server has not answered, under its client id. */
export function optimisticMessage(
  { channelId, text, attachments, answering, clientMessageId }: Outgoing,
  author: Pick<User, "id" | "displayName">,
): Message {
  return {
    id: clientMessageId,
    channelId,
    author: { id: author.id, displayName: author.displayName },
    content: text,
    attachments: [...attachments],
    // Nothing has unfurled yet; the server pushes the cards once it has.
    embeds: [],
    createdAt: new Date().toISOString(),
    ...(answering === null ? {} : { replyTo: answering }),
  };
}

export function toSendMessage({
  channelId,
  text,
  attachments,
  answering,
  clientMessageId,
}: Outgoing): SendMessage {
  return {
    channelId,
    content: text,
    attachmentIds: attachments.map((attachment) => attachment.id),
    clientMessageId,
    ...(answering === null ? {} : { replyToMessageId: answering.id }),
  };
}
