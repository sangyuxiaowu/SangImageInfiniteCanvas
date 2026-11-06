import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";

export function useCanvasNodeSizes(nodeIds: string, projectId: string | null) {
  const [sizes, setSizes] = useState(new Map<string, { width: number; height: number }>());

  useLayoutEffect(() => {
    const elements = (JSON.parse(nodeIds) as string[])
      .map((id) => document.getElementById(`canvas-node-${id}`))
      .filter((element): element is HTMLElement => element !== null);
    const measure = () => {
      setSizes((previous) => {
        const next = new Map<string, { width: number; height: number }>();
        for (const element of elements) {
          next.set(element.id, { width: element.offsetWidth, height: element.offsetHeight });
        }
        if (previous.size === next.size && [...next].every(([id, size]) => {
          const old = previous.get(id);
          return old?.width === size.width && old.height === size.height;
        })) return previous;
        return next;
      });
    };
    measure();
    // ResizeObserver runs before paint; commit port changes in that same frame.
    const observer = new ResizeObserver(() => flushSync(measure));
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [nodeIds, projectId]);

  return sizes;
}
