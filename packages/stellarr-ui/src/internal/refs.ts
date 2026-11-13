import { useCallback, type Ref, type RefCallback } from "react";

/** Points every ref at the same node. */
export function composeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }
  };
}

/**
 * `composeRefs` kept stable between renders. A new callback on every render
 * makes React detach and attach the refs on every commit.
 */
export function useComposedRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  // The refs themselves are the dependencies.
  return useCallback(composeRefs(...refs), refs);
}
