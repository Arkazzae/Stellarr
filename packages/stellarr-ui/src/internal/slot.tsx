import { Children, cloneElement, isValidElement, type ReactNode, type Ref } from "react";

import { cx } from "../cx";
import { composeRefs } from "./refs";

type Props = Record<string, unknown>;

/**
 * The child's props win, except that classes join, styles merge, refs both
 * receive the node and both handlers run: the child's first, so a child that
 * calls `preventDefault()` can stop what the component would do next.
 */
function mergeProps(slot: Props, child: Props): Props {
  const merged: Props = { ...slot, ...child };
  for (const key of Object.keys(slot)) {
    const own = slot[key];
    const theirs = child[key];
    if (/^on[A-Z]/.test(key) && typeof own === "function" && typeof theirs === "function") {
      merged[key] = (...args: unknown[]) => {
        theirs(...args);
        own(...args);
      };
    } else if (key === "className") {
      merged[key] = cx(own as string | undefined, theirs as string | undefined);
    } else if (key === "style") {
      merged[key] = { ...(own as object), ...(theirs as object) };
    } else if (key === "ref") {
      merged[key] = composeRefs(own as Ref<unknown>, theirs as Ref<unknown> | undefined);
    }
  }
  return merged;
}

export interface SlotProps extends Props {
  children?: ReactNode;
}

/**
 * Renders its one child element with the component's props merged in, so
 * `asChild` can give a link the look and behaviour of a button or a menu item.
 */
export function Slot({ children, ...props }: SlotProps) {
  const child = Children.only(children);
  if (!isValidElement<Props>(child)) return null;
  return cloneElement(child, mergeProps(props, child.props));
}
