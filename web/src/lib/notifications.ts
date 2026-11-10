export interface MessageNotificationContext {
  authorId: string;
  channelId: string;
  content?: string;
  selfId: string | null;
  selfUsername?: string | null;
  openChannelId: string | null;
  soundEnabled: boolean;
  mentionsOnly?: boolean;
  mutedChannelIds: readonly string[];
}

/** A mention inside code or a link is text being quoted, not someone being addressed. */
function withoutCodeAndLinks(content: string): string {
  return content
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`\n]*(?:`|$)/g, " ")
    .replace(/<code>[\s\S]*?(?:<\/code>|$)/gi, " ")
    .replace(/https?:\/\/[^\s<>'"`]+/gi, " ");
}

function mentionsUsername(content: string, username: string): boolean {
  const literal = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A name continues through letters, digits and `_ . -`, so `@ada` neither
  // matches inside `@adam` nor inside an address such as `x@ada`. The start
  // is matched with a plain group because older Safari has no lookbehind.
  const mention = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_.-])@${literal}(?![\\p{L}\\p{N}_.-])`,
    "iu",
  );
  return mention.test(withoutCodeAndLinks(content));
}

/** Whether an incoming channel message should call attention with a sound. */
export function shouldPlayMessageNotificationSound({
  authorId,
  channelId,
  content = "",
  selfId,
  selfUsername = null,
  openChannelId,
  soundEnabled,
  mentionsOnly = false,
  mutedChannelIds,
}: MessageNotificationContext): boolean {
  if (!soundEnabled || authorId === selfId || mutedChannelIds.includes(channelId)) {
    return false;
  }
  if (selfUsername !== null && mentionsUsername(content, selfUsername)) return true;
  return !mentionsOnly && channelId !== openChannelId;
}
