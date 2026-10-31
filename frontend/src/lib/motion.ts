import { useEffect, useRef, useState } from 'react';

export function useTweenNumber(value: number, duration = 400): number {
  const [display, setDisplay] = useState(value);
  const current = useRef(value);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = value;
      setDisplay(value);
      return;
    }
    const startValue = current.current;
    const startTime = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = startValue + (value - startValue) * eased;
      current.current = next;
      setDisplay(Math.round(next));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return display;
}
