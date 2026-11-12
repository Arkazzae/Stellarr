"use client";

import { Icon } from "@stellarr/ui/icons";
import type { ChannelThreadVM } from "@/components/view-models";
import { useLanguage } from "@/state/hooks";

/** Room a single collapsed-to-expanded row needs, in px; CSS animates to it. */
const THREAD_ROW_HEIGHT = 44;

export interface ChannelThreadsProps {
  /** Id of the list; the channel's toggle points at it with `aria-controls`. */
  id: string;
  channelName: string;
  threads: ChannelThreadVM[];
  open: boolean;
  /** The room is showing this channel, so its current thread is the page. */
  channelActive: boolean;
  activeThreadId: string | null;
  openingThreadId: string | null;
  onOpen?: (thread: ChannelThreadVM) => void;
  /** Gives the rail each thread's button, which it moves focus onto. */
  register: (threadId: string, button: HTMLButtonElement | null) => void;
}

/**
 * The threads nested below a text channel in the rail.
 *
 * A thread opened from a message never went through the channel's toggle, so
 * the list opens itself for the thread it holds; the rail moves keyboard focus
 * to the same row the visual selection names.
 */
export function ChannelThreads({
  id,
  channelName,
  threads,
  open,
  channelActive,
  activeThreadId,
  openingThreadId,
  onOpen,
  register,
}: ChannelThreadsProps) {
  const { t } = useLanguage();

  return (
    <ul
      id={id}
      className={open ? "channel-threads" : "channel-threads closed"}
      style={{ maxHeight: open ? `${threads.length * THREAD_ROW_HEIGHT}px` : "0px" }}
      inert={!open}
      aria-label={t("shell.channelThreads", { name: channelName })}
    >
      {threads.map((thread) => {
        const replies = t(
          thread.replyCount === 1
            ? "shell.threadReply.one"
            : "shell.threadReply.many",
          { count: thread.replyCount },
        );
        const active = thread.id === activeThreadId;
        return (
          <li key={thread.id}>
            <button
              ref={(button) => register(thread.id, button)}
              type="button"
              className="channel-thread"
              aria-label={t("shell.openThread", {
                preview: thread.preview,
                author: thread.authorName,
                replies,
              })}
              aria-current={channelActive && active ? "page" : undefined}
              aria-busy={thread.id === openingThreadId || undefined}
              onClick={() => onOpen?.(thread)}
            >
              <span className="channel-thread-icon" aria-hidden="true">
                <Icon name="thread" size={13} />
              </span>
              <span className="channel-thread-copy">
                <span className="channel-thread-preview">{thread.preview}</span>
                <span className="channel-thread-meta">
                  {thread.authorName} · {replies}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
