import { DependencyList, useLayoutEffect, useRef } from "react";

export function useDebouncedSave(save: () => void, dependencies: DependencyList) {
  const pending = useRef<(() => void) | null>(null);

  // Persist the latest snapshot even when the debounce has not elapsed.
  useLayoutEffect(() => {
    const flush = () => {
      const callback = pending.current;
      pending.current = null;
      callback?.();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useLayoutEffect(() => {
    pending.current = save;
    const timer = setTimeout(() => {
      if (pending.current !== save) return;
      pending.current = null;
      save();
    }, 250);
    return () => clearTimeout(timer);
  }, dependencies);
}
