import { describe, expect, it } from 'vitest';
import { PriorityQueue } from '../src/queue/priorityQueue';
import { computeForecast, overrunLevel, type ForecastStep } from '../src/domain/forecast';
import { evaluateSla, mergeSla } from '../src/domain/sla';
import { canTransition, TRANSITIONS } from '../src/domain/ticketStateMachine';
import { WORK_PLANS } from '../src/domain/workPlans';
import { computeProgress } from '../src/domain/progress';
import { ScaledClock } from '../src/utils/clock';

describe('PriorityQueue', () => {
  it('serves lowest score first and supports lazy removal', () => {
    const q = new PriorityQueue();
    [['c', 3], ['a', 1], ['d', 4], ['b', 2]].forEach(([id, score]) => q.push({ id: id as string, score: score as number }));
    q.remove('b');
    expect(q.size).toBe(3);
    expect([q.pop()?.id, q.pop()?.id, q.pop()?.id, q.pop()]).toEqual(['a', 'c', 'd', undefined]);
  });
  it('ignores duplicate ids', () => {
    const q = new PriorityQueue();
    q.push({ id: 'x', score: 1 }); q.push({ id: 'x', score: 0 });
    expect(q.size).toBe(1);
  });
});

describe('forecast: the 20-minute task that takes 50 minutes', () => {
  const clock = new ScaledClock(1);
  const t0 = new Date('2026-01-01T10:00:00Z');
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  const steps = (s1: Partial<ForecastStep>): ForecastStep[] => [
    { id: 's1', status: 'IN_PROGRESS', estimatedMinutes: 20, actualMinutes: null, startedAt: t0, dependsOn: [], ...s1 },
    { id: 's2', status: 'LOCKED', estimatedMinutes: 5, actualMinutes: null, startedAt: null, dependsOn: ['s1'] },
    { id: 's3', status: 'LOCKED', estimatedMinutes: 5, actualMinutes: null, startedAt: null, dependsOn: ['s2'] },
  ];

  it('within estimate: finish = estimate chain', () => {
    const f = computeForecast(steps({}), clock, at(10));
    expect(f.estimatedTotalMin).toBe(30);
    expect(Math.round((f.forecastFinish!.getTime() - at(10).getTime()) / 60000)).toBe(20); // 10 left + 5 + 5
    expect(f.steps['s1']!.overrun).toBe(false);
  });
  it('past estimate: flagged OVERRUN, forecast keeps moving, nothing is forced', () => {
    const f = computeForecast(steps({}), clock, at(50));
    expect(f.steps['s1']!.overrun).toBe(true);
    expect(f.steps['s1']!.overrunLevel).toBe(3); // 2.5x >= 2.0x
    expect(f.steps['s2']!.etaMinutes).toBeGreaterThan(f.steps['s1']!.etaMinutes);
    expect(f.forecastFinish!.getTime()).toBeGreaterThan(at(50).getTime());
  });
  it('overrun levels at 1.0x / 1.5x / 2.0x', () => {
    expect([overrunLevel(19, 20), overrunLevel(20, 20), overrunLevel(30, 20), overrunLevel(40, 20)]).toEqual([0, 1, 2, 3]);
  });
  it('independent steps overlap (max) while dependent steps add up', () => {
    const f = computeForecast([
      { id: 'a', status: 'READY', estimatedMinutes: 20, actualMinutes: null, startedAt: null, dependsOn: [] },
      { id: 'b', status: 'READY', estimatedMinutes: 15, actualMinutes: null, startedAt: null, dependsOn: [] },
      { id: 'c', status: 'LOCKED', estimatedMinutes: 10, actualMinutes: null, startedAt: null, dependsOn: ['a', 'b'] },
    ], clock, t0);
    expect(f.steps['c']!.etaMinutes).toBe(30); // max(20,15) + 10, not 45
  });
  it('actual total counts finished + running time', () => {
    const f = computeForecast([
      { id: 'a', status: 'DONE', estimatedMinutes: 20, actualMinutes: 50, startedAt: t0, dependsOn: [] },
      { id: 'b', status: 'DONE', estimatedMinutes: 5, actualMinutes: 5, startedAt: t0, dependsOn: ['a'] },
      { id: 'c', status: 'DONE', estimatedMinutes: 5, actualMinutes: 5, startedAt: t0, dependsOn: ['b'] },
    ], clock, at(60));
    expect(f.estimatedTotalMin).toBe(30);
    expect(f.actualTotalMin).toBe(60);
    expect(f.forecastFinish).toBeNull();
  });
});

describe('SLA evaluation', () => {
  const created = new Date('2026-01-01T00:00:00Z');
  const deadline = new Date('2026-01-01T04:00:00Z');
  const base = { createdAt: created, deadline, warningPct: 75, forecastFinish: null, status: 'IN_PROGRESS' as const, resolvedAt: null };
  it('moves ON_TRACK -> AT_RISK (predicted) -> WARNING -> BREACHED', () => {
    expect(evaluateSla({ ...base, now: new Date('2026-01-01T01:00:00Z') })).toBe('ON_TRACK');
    expect(evaluateSla({ ...base, now: new Date('2026-01-01T01:00:00Z'), forecastFinish: new Date('2026-01-01T05:00:00Z') })).toBe('AT_RISK');
    expect(evaluateSla({ ...base, now: new Date('2026-01-01T03:10:00Z') })).toBe('WARNING');
    expect(evaluateSla({ ...base, now: new Date('2026-01-01T04:01:00Z') })).toBe('BREACHED');
  });
  it('freezes after resolution', () => {
    const r = { ...base, now: new Date('2026-01-02T00:00:00Z'), status: 'RESOLVED' as const };
    expect(evaluateSla({ ...r, resolvedAt: new Date('2026-01-01T03:00:00Z') })).toBe('ON_TRACK');
    expect(evaluateSla({ ...r, resolvedAt: new Date('2026-01-01T05:00:00Z') })).toBe('BREACHED');
  });
  it('WARNING/BREACHED never regress', () => {
    expect(mergeSla('WARNING', 'AT_RISK')).toBe('WARNING');
    expect(mergeSla('AT_RISK', 'ON_TRACK')).toBe('ON_TRACK');
  });
});

describe('ticket state machine & plans', () => {
  it('only allows the documented transitions', () => {
    expect(canTransition('IN_PROGRESS', 'VERIFYING')).toBe(true);
    expect(canTransition('OPEN', 'RESOLVED')).toBe(false);
    expect(canTransition('CLOSED', 'IN_PROGRESS')).toBe(false);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });
  it('every work plan is a valid acyclic graph (deps point backwards)', () => {
    for (const plan of Object.values(WORK_PLANS)) plan.forEach((s, i) => s.dependsOn.forEach((d) => expect(d).toBeLessThan(i)));
  });
  it('progress is monotonic through the happy path', () => {
    const p = ['OPEN', 'AWAITING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => computeProgress(s as never, [{ status: 'DONE' }]));
    expect([...p].sort((a, b) => a - b)).toEqual(p);
  });
});
