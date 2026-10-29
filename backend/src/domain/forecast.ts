import type { StepStatus } from '@prisma/client';
import type { Clock } from '../utils/clock';

export interface ForecastStep {
  id: string;
  status: StepStatus;
  estimatedMinutes: number;
  actualMinutes: number | null;
  startedAt: Date | null;
  dependsOn: string[];
}

export interface StepForecast {
  /** Simulated minutes from now until this step is expected to finish (0 if finished). */
  etaMinutes: number;
  elapsedMinutes: number;
  overrunLevel: 0 | 1 | 2 | 3; // 0 none, 1 >=1.0x, 2 >=1.5x, 3 >=2.0x
  overrun: boolean;
}

export interface Forecast {
  forecastFinish: Date | null;
  estimatedTotalMin: number;
  actualTotalMin: number;
  steps: Record<string, StepForecast>;
}

const OVERRUN_FLOOR_MIN = 5;
const OVERRUN_FRACTION = 0.25;

export function overrunLevel(elapsedMin: number, estimateMin: number): 0 | 1 | 2 | 3 {
  if (estimateMin <= 0) return 0;
  const r = elapsedMin / estimateMin;
  if (r >= 2) return 3;
  if (r >= 1.5) return 2;
  if (r >= 1) return 1;
  return 0;
}

/**
 * Forecast the finish time of a work plan (a dependency graph).
 *  - sequential steps add up, independent steps overlap (max, not sum)
 *  - a running step within estimate finishes at (estimate - elapsed)
 *  - a running step OVER estimate is assumed to need max(25% of estimate, 5 min) more
 *    (optimistic but never zero) -> this is how a 20-minute task that takes 50 minutes
 *    pushes every dependent step later without ever stopping the technician.
 */
export function computeForecast(steps: ForecastStep[], clock: Clock, now: Date = clock.now()): Forecast {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map<string, number>();
  const result: Forecast['steps'] = {};

  const elapsedOf = (s: ForecastStep): number => {
    if (s.status === 'DONE') return s.actualMinutes ?? 0;
    if (s.status === 'IN_PROGRESS' && s.startedAt) return clock.simMinutes(s.startedAt, now);
    return 0;
  };

  const finishOffset = (id: string, stack: Set<string> = new Set()): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const s = byId.get(id);
    if (!s) return 0;
    if (stack.has(id)) return 0; // defensive: cycles are rejected on write
    stack.add(id);

    let value: number;
    if (s.status === 'DONE' || s.status === 'SKIPPED') {
      value = 0;
    } else if (s.status === 'IN_PROGRESS') {
      const elapsed = elapsedOf(s);
      value = elapsed < s.estimatedMinutes
        ? s.estimatedMinutes - elapsed
        : Math.max(OVERRUN_FRACTION * s.estimatedMinutes, OVERRUN_FLOOR_MIN);
    } else {
      const start = s.dependsOn.reduce((m, d) => Math.max(m, finishOffset(d, stack)), 0);
      value = start + s.estimatedMinutes;
    }
    stack.delete(id);
    memo.set(id, value);
    return value;
  };

  let maxOffset = 0;
  let estimatedTotal = 0;
  let actualTotal = 0;
  for (const s of steps) {
    const eta = finishOffset(s.id);
    maxOffset = Math.max(maxOffset, eta);
    const elapsed = elapsedOf(s);
    const level = s.status === 'IN_PROGRESS' ? overrunLevel(elapsed, s.estimatedMinutes) : 0;
    result[s.id] = { etaMinutes: round1(eta), elapsedMinutes: round1(elapsed), overrunLevel: level, overrun: level > 0 };
    if (s.status !== 'SKIPPED') estimatedTotal += s.estimatedMinutes;
    if (s.status === 'DONE') actualTotal += s.actualMinutes ?? 0;
    else if (s.status === 'IN_PROGRESS') actualTotal += Math.round(elapsed);
  }

  const active = steps.some((s) => s.status !== 'DONE' && s.status !== 'SKIPPED');
  return {
    forecastFinish: steps.length === 0 || !active ? null : clock.addSimMinutes(now, maxOffset),
    estimatedTotalMin: estimatedTotal,
    actualTotalMin: actualTotal,
    steps: result,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
