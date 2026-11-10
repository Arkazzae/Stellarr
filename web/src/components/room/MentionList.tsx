"use client";

import type { MentionCandidate } from "./composerMentions";

export function mentionOptionId(listId: string, candidate: MentionCandidate): string {
  return `${listId}-${candidate.id}`;
}

export interface MentionListProps {
  id: string;
  label: string;
  candidates: readonly MentionCandidate[];
  selectedIndex: number;
  onChoose(candidate: MentionCandidate): void;
}

/**
 * The members offered after typing `@`. Focus never leaves the textarea: the
 * list is a combobox popup, navigated from the field with the arrow keys, so
 * pressing an option must not blur it.
 */
export function MentionList({
  id,
  label,
  candidates,
  selectedIndex,
  onChoose,
}: MentionListProps) {
  return (
    <div id={id} className="mention-suggestions" role="listbox" aria-label={label}>
      {candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          id={mentionOptionId(id, candidate)}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={index === selectedIndex ? "selected" : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(candidate)}
        >
          <span className="mention-avatar" aria-hidden="true">
            {candidate.displayName.trim().slice(0, 2).toLocaleUpperCase()}
          </span>
          <span className="mention-copy">
            <b>{candidate.displayName}</b>
            <small>@{candidate.username}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
