import { describe, expect, it } from "vitest";

import { shouldKeepNativeMenu } from "./useContextMenuPolicy";

function rightClick(target: Node, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("shouldKeepNativeMenu", () => {
  it("suppresses the browser's menu on ordinary chrome", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(shouldKeepNativeMenu(rightClick(button))).toBe(false);

    button.remove();
  });

  it("keeps it on the targets the browser knows more about than we do", () => {
    for (const html of [
      "<input>",
      "<textarea></textarea>",
      "<a href='https://example.test'><span>x</span></a>",
      "<img alt='x'>",
      "<video></video>",
      "<div contenteditable='true'></div>",
      "<div data-native-menu><b>x</b></div>",
    ]) {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.append(host);
      // The deepest node, so the closest-ancestor walk is what is being tested
      // rather than a direct hit on the element itself.
      const target = host.querySelector("span,b") ?? host.firstElementChild;
      expect(target).not.toBeNull();
      expect(shouldKeepNativeMenu(rightClick(target as Element))).toBe(true);
      host.remove();
    }
  });

  it("keeps it while text is selected under the pointer", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "zaznaczony tekst";
    document.body.append(paragraph);

    expect(shouldKeepNativeMenu(rightClick(paragraph))).toBe(false);

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(shouldKeepNativeMenu(rightClick(paragraph))).toBe(true);

    // A selection somewhere else is not a reason to keep the menu here.
    const button = document.createElement("button");
    document.body.append(button);
    expect(shouldKeepNativeMenu(rightClick(button))).toBe(false);

    selection?.removeAllRanges();
    paragraph.remove();
    button.remove();
  });

  it("leaves Shift and an already-handled event alone", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(shouldKeepNativeMenu(rightClick(button, { shiftKey: true }))).toBe(true);

    // What the app's own menus do: they have already decided.
    const handled = rightClick(button);
    handled.preventDefault();
    expect(shouldKeepNativeMenu(handled)).toBe(true);

    button.remove();
  });
});
