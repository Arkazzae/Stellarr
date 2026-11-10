/** A new draft and where the selection should sit in it. */
export interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Puts an emoji at `at`, spaced from the words around it so the next thing
 * typed starts a new word instead of sticking to the glyph.
 */
export function insertEmojiAt(text: string, at: number, glyph: string): TextEdit {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = /^\s/.test(after) ? "" : " ";
  const inserted = `${lead}${glyph}${trail}`;
  const caret = before.length + inserted.length;
  return {
    text: `${before}${inserted}${after}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/**
 * Wraps the selection in a Markdown marker, or unwraps it when the marker is
 * already on both sides. With nothing selected, the caret lands inside a fresh
 * pair. The selection stays on the same words either way.
 */
export function toggleMarker(
  text: string,
  start: number,
  end: number,
  marker: string,
): TextEdit {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const wrapped = before.endsWith(marker) && after.startsWith(marker);
  const from = wrapped ? start - marker.length : start + marker.length;
  return {
    text: wrapped
      ? `${before.slice(0, -marker.length)}${selected}${after.slice(marker.length)}`
      : `${before}${marker}${selected}${marker}${after}`,
    selectionStart: from,
    selectionEnd: from + selected.length,
  };
}

/** The body of a message sent in code mode. */
export function fencedCode(language: string, source: string): string {
  return `\`\`\`${language}\n${source}\n\`\`\``;
}
