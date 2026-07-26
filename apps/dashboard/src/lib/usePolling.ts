import { useEffect, useState } from 'react';

export type PollOptions = {
  intervalMs?: number;
  enabled?: boolean;
  /** When true, pauses while the document is hidden. */
  pauseWhenHidden?: boolean;
};

/**
 * Runs an async loader on an interval. Pauses when the tab is hidden by default.
 */
export function usePolling(
  load: () => Promise<void>,
  options: PollOptions = {},
): { refresh: () => Promise<void> } {
  const intervalMs = options.intervalMs ?? 4000;
  const enabled = options.enabled ?? true;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (cancelled) {
        return;
      }
      if (pauseWhenHidden && document.visibilityState === 'hidden') {
        return;
      }
      await load();
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Intentionally depend on tick for manual refresh restarts; load identity is owned by callers.
  }, [enabled, intervalMs, pauseWhenHidden, tick, load]);

  return {
    refresh: async () => {
      await load();
      setTick((value) => value + 1);
    },
  };
}
