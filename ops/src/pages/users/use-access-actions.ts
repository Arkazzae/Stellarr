import { useCallback, useState } from "react";

export interface Notice {
  message: string;
  error: boolean;
}

/**
 * Runs one change, reads the lists again and reports the outcome in the notice.
 * Resolves to whether the change went through, so a form knows when it may close.
 */
export type Perform = (
  action: () => Promise<unknown>,
  success: string,
  failure: string,
) => Promise<boolean>;

export function useAccessActions(refresh: () => Promise<void>) {
  const [notice, setNotice] = useState<Notice | null>(null);

  const perform = useCallback<Perform>(
    async (action, success, failure) => {
      try {
        await action();
        await refresh();
        setNotice({ message: success, error: false });
        return true;
      } catch (cause) {
        setNotice({ message: cause instanceof Error ? cause.message : failure, error: true });
        return false;
      }
    },
    [refresh],
  );

  return { notice, perform };
}
