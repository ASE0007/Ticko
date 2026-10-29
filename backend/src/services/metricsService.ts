import { prisma } from '../repositories/prisma';
import { clock } from '../utils/clock';
import { env } from '../config/env';
import { OPEN_STATUSES } from '../config/constants';
import { jobQueue } from '../queue/jobQueue';
import { hub } from '../realtime/wsHub';

export async function getMetrics() {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [byStatus, openSla, techs, created24, resolved24] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['slaState'], where: { status: { in: OPEN_STATUSES.filter((s) => s !== 'RESOLVED') } }, _count: { _all: true } }),
    prisma.technician.aggregate({ _sum: { activeTickets: true, maxActive: true }, _count: { _all: true }, where: { user: { active: true } } }),
    prisma.ticket.count({ where: { createdAt: { gte: since } } }),
    prisma.ticket.count({ where: { resolvedAt: { gte: since } } }),
  ]);
  const status = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
  const sla = Object.fromEntries(openSla.map((r) => [r.slaState, r._count._all]));
  const open = OPEN_STATUSES.reduce((n, s) => n + (status[s] ?? 0), 0);
  const active = techs._sum.activeTickets ?? 0;
  const cap = techs._sum.maxActive ?? 0;
  return {
    tickets: { open, createdLast24h: created24, resolvedLast24h: resolved24, byStatus: status, unassigned: (status['AWAITING_ASSIGNMENT'] ?? 0) + (status['REOPENED'] ?? 0) },
    sla: { onTrack: sla['ON_TRACK'] ?? 0, atRisk: sla['AT_RISK'] ?? 0, warning: sla['WARNING'] ?? 0, breached: sla['BREACHED'] ?? 0 },
    queue: jobQueue.stats(),
    technicians: { count: techs._count._all, activeTickets: active, capacity: cap, utilisationPct: cap ? Math.round((active / cap) * 100) : 0 },
    realtime: { clients: hub.clientCount() },
    config: { timeScale: clock.scale, demoMode: env.DEMO_MODE, maxActiveTickets: env.MAX_ACTIVE_TICKETS },
    ts: new Date().toISOString(),
  };
}

export async function reportSummary(range: { from?: Date | undefined; to?: Date | undefined }) {
  const createdAt = { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) };
  const where = Object.keys(createdAt).length ? { createdAt } : {};
  const [tickets, steps] = await Promise.all([
    prisma.ticket.findMany({ where, select: { categoryRef: { select: { name: true } }, priority: true, status: true, createdAt: true, resolvedAt: true, slaDeadline: true, reopenCount: true, technician: { select: { id: true, user: { select: { name: true } } } } } }),
    prisma.workStep.findMany({ where: { status: 'DONE', ticket: where }, select: { estimatedMinutes: true, actualMinutes: true } }),
  ]);
  const resolved = tickets.filter((t) => t.resolvedAt);
  const mins = resolved.map((t) => clock.simMinutes(t.createdAt, t.resolvedAt as Date));
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const within = resolved.filter((t) => (t.resolvedAt as Date) <= t.slaDeadline).length;
  const est = steps.reduce((a, s) => a + s.estimatedMinutes, 0);
  const act = steps.reduce((a, s) => a + (s.actualMinutes ?? 0), 0);
  const count = <T extends string>(key: (t: (typeof tickets)[number]) => T) => {
    const m: Record<string, number> = {};
    for (const t of tickets) m[key(t)] = (m[key(t)] ?? 0) + 1;
    return m;
  };
  const perTech = new Map<string, { name: string; resolved: number; minutes: number[] }>();
  for (const t of resolved) {
    if (!t.technician) continue;
    const e = perTech.get(t.technician.id) ?? { name: t.technician.user.name, resolved: 0, minutes: [] };
    e.resolved++;
    e.minutes.push(clock.simMinutes(t.createdAt, t.resolvedAt as Date));
    perTech.set(t.technician.id, e);
  }
  return {
    total: tickets.length,
    resolved: resolved.length,
    avgResolutionMin: avg(mins),
    slaCompliancePct: resolved.length ? Math.round((within / resolved.length) * 100) : 100,
    reopenRatePct: tickets.length ? Math.round((tickets.filter((t) => t.reopenCount > 0).length / tickets.length) * 100) : 0,
    estimateAccuracy: { estimatedMin: est, actualMin: act, ratio: est ? Math.round((act / est) * 100) / 100 : 1, stepsMeasured: steps.length },
    byCategory: count((t) => t.categoryRef.name), byPriority: count((t) => t.priority), byStatus: count((t) => t.status),
    technicians: [...perTech.values()].map((e) => ({ name: e.name, resolved: e.resolved, avgResolutionMin: avg(e.minutes) })).sort((a, b) => b.resolved - a.resolved),
  };
}
