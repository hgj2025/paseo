import { useLayoutEffect, useState, type RefObject } from "react";

/** Hidden retained streams keep their last valid geometry until shown again. */
export function useStreamContentWidth(ref: RefObject<HTMLElement | null>, active: boolean) {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (Number.isFinite(next) && next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, ref]);
  return width;
}
