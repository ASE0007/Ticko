import { describe, expect, it } from 'vitest';
import { ScaledClock } from '../src/utils/clock';
import { sleep } from '../src/utils/sleep';

describe('ScaledClock', () => {
  it('scales durations, not timestamps', () => {
    const c = new ScaledClock(60);
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-01-01T00:00:01Z'); // 1 real second
    expect(c.simMinutes(t0, t1)).toBe(1);
    expect(c.addSimMinutes(t0, 60).getTime() - t0.getTime()).toBe(60_000);
  });

  it('is identity at scale 1', () => {
    const c = new ScaledClock(1);
    const t0 = new Date('2026-01-01T00:00:00Z');
    expect(c.simMinutes(t0, new Date(t0.getTime() + 120_000))).toBe(2);
  });
});

describe('sleep', () => {
  it('aborts via AbortSignal', async () => {
    const ctrl = new AbortController();
    const p = sleep(10_000, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
