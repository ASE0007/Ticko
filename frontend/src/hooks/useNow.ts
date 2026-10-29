import { useEffect, useState } from 'react';

/** One shared clock per interval length, so 100 countdowns use 1 timer. */
const timers = new Map<number, { subs: Set<(n: number) => void>; id: ReturnType<typeof setInterval> }>();

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t = timers.get(intervalMs);
    if (!t) {
      const subs = new Set<(n: number) => void>();
      t = { subs, id: setInterval(() => { const n = Date.now(); subs.forEach((f) => f(n)); }, intervalMs) };
      timers.set(intervalMs, t);
    }
    t.subs.add(setNow);
    return () => {
      t!.subs.delete(setNow);
      if (t!.subs.size === 0) { clearInterval(t!.id); timers.delete(intervalMs); }
    };
  }, [intervalMs]);
  return now;
}
