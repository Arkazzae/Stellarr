"use client";

import { useCallback, type Ref, type RefCallback } from "react";

/**
 * Points every ref at the same node, whether it is a callback or an object.
 * The result is a new function on every call; see `useComposedRefs` for one
 * that keeps still between renders.
 */
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
 * makes React detach and attach the refs on every commit. Pass the same refs
 * on every render, as they are the dependencies.
 */
export function useComposedRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  // The refs themselves are the dependencies.
  return useCallback(composeRefs(...refs), refs);
}
