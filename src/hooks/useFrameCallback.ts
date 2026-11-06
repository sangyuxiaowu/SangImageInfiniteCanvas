import { useEffect, useRef } from "react";
import { useLatestCallback } from "./useLatestCallback";

export function useFrameCallback<Args extends unknown[]>(callback: (...args: Args) => void) {
  const frame = useRef<number | null>(null);
  const pending = useRef<Args | null>(null);
  const invoke = useLatestCallback(callback);
  const flush = useLatestCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const args = pending.current;
    pending.current = null;
    if (args) invoke(...args);
  });
  const schedule = useLatestCallback((...args: Args) => {
    pending.current = args;
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  });

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  return { schedule, flush };
}
