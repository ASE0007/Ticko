import { animate } from 'framer-motion';
import { useEffect, useRef } from 'react';

/** Counts smoothly between values (KPI tiles). */
export function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const controls = animate(prev.current, value, {
      duration: reduce ? 0 : 0.6, ease: 'easeOut',
      onUpdate: (v) => { node.textContent = `${Math.round(v)}${suffix}`; },
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, suffix]);
  return <span ref={ref}>{value}{suffix}</span>;
}
