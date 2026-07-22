'use client';

/**
 * useContainerScale — measure a container and return a scale factor that fits a
 * fixed-geometry surface (a letter page, a 700px slide) into the actual
 * available width, never upscaling past 1. Lifts the canvas-renderer logic so
 * every fixed-size canvas fits any pane, including a Chrome split-screen half.
 *
 *   const [ref, scale] = useContainerScale(816);   // letter width @96dpi
 *   <div ref={ref}> <div style={{ transform:`scale(${scale})` }} /> </div>
 */

import { useEffect, useRef, useState } from 'react';

export function useContainerScale(
  referenceWidth: number,
  opts: { min?: number; pad?: number } = {},
): [React.RefObject<HTMLDivElement | null>, number] {
  const { min = 0.25, pad = 32 } = opts;
  const ref = useRef<HTMLDivElement | null>(null);
  const [avail, setAvail] = useState(referenceWidth + pad);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setAvail(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(1, Math.max(min, (avail - pad) / referenceWidth));
  return [ref, scale];
}
