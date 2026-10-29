import { prisma } from '../repositories/prisma';
import { clock } from '../utils/clock';
import { Errors } from '../utils/errors';

interface Interval { start: number; end: number }

/** Merge overlapping work blocks so parallel steps are not double counted. */
function merge(iv: Interval[]): Interval[] {
  const sorted = [...iv].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Everything one technician did in [from, to): every work step with real start/end clock times,
 * estimated vs actual, overruns, tickets assigned / resolved, and active vs idle time.
 */
export async function technicianDay(technicianId: string, from: Date, to: Date) {
  const tech = await prisma.technician.findUnique({ where: { id: technicianId }, include: { user: { select: { name: true, email: true } } } });
  if (!tech) throw Errors.notFound('Technician');
  const now = clock.now();

  const steps = await prisma.workStep.findMany({
    where: { assigneeId: technicianId, startedAt: { not: null, lt: to }, OR: [{ completedAt: null }, { completedAt: { gte: from } }] },
    include: { ticket: { select: { id: true, number: true, title: true, priority: true, customer: { select: { name: true, area: true } } } } },
    orderBy: { startedAt: 'asc' },
  });
  const notes = steps.length
    ? await prisma.statusHistory.findMany({ where: { entity: 'STEP', toValue: 'DONE', entityId: { in: steps.map((s) => s.id) } }, select: { entityId: true, message: true } })
    : [];
  const noteOf = new Map(notes.map((n) => [n.entityId, n.message]));

  const items = steps.map((s) => {
    const startedAt = s.startedAt as Date;
    const running = !s.completedAt;
    const actual = s.actualMinutes ?? Math.max(1, Math.round(clock.simMinutes(startedAt, now)));
    const over = Math.max(0, actual - s.estimatedMinutes);
    return {
      stepId: s.id, ticketId: s.ticketId, ticketNo: `TX-${s.ticket.number}`, ticketTitle: s.ticket.title, priority: s.ticket.priority,
      customer: s.ticket.customer.name, area: s.ticket.customer.area, step: s.title, seq: s.seq,
      status: running ? 'IN_PROGRESS' : 'DONE', startedAt, completedAt: s.completedAt,
      estimatedMinutes: s.estimatedMinutes, actualMinutes: actual, overrunMinutes: over, overrun: over > 0, note: noteOf.get(s.id) ?? null,
    };
  });

  const done = items.filter((i) => i.status === 'DONE' && (i.completedAt as Date) >= from && (i.completedAt as Date) < to);
  const blocks = merge(items.map((i) => ({ start: Math.max(i.startedAt.getTime(), from.getTime()), end: Math.min((i.completedAt ?? now).getTime(), to.getTime(), now.getTime()) })).filter((b) => b.end > b.start));
  let activeMin = 0;
  let idleMin = 0;
  blocks.forEach((b, idx) => {
    activeMin += clock.simMinutes(new Date(b.start), new Date(b.end));
    const next = blocks[idx + 1];
    if (next) idleMin += clock.simMinutes(new Date(b.end), new Date(next.start));
  });

  const [assignments, resolved] = await Promise.all([
    prisma.ticketAssignment.findMany({ where: { technicianId, role: 'PRIMARY', assignedAt: { gte: from, lt: to } }, include: { ticket: { select: { number: true, title: true } } }, orderBy: { assignedAt: 'asc' } }),
    prisma.ticket.findMany({ where: { technicianId, resolvedAt: { gte: from, lt: to } }, select: { id: true, number: true, title: true, resolvedAt: true, slaState: true }, orderBy: { resolvedAt: 'asc' } }),
  ]);

  const est = done.reduce((a, i) => a + i.estimatedMinutes, 0);
  const act = done.reduce((a, i) => a + i.actualMinutes, 0);
  return {
    technician: { id: tech.id, name: tech.user.name, email: tech.user.email, skills: tech.skills },
    range: { from, to },
    summary: {
      stepsCompleted: done.length,
      stepsInProgress: items.filter((i) => i.status === 'IN_PROGRESS').length,
      ticketsWorked: new Set(items.map((i) => i.ticketId)).size,
      ticketsAssigned: assignments.length,
      ticketsResolved: resolved.length,
      estimatedMinutes: est,
      actualMinutes: act,
      accuracyPct: est ? Math.round((act / est) * 100) : null,
      overrunSteps: done.filter((i) => i.overrun).length,
      overrunMinutes: done.reduce((a, i) => a + i.overrunMinutes, 0),
      activeMinutes: round1(activeMin),
      idleMinutes: round1(idleMin),
      firstActivity: blocks[0] ? new Date(blocks[0].start) : null,
      lastActivity: blocks.length ? new Date((blocks[blocks.length - 1] as Interval).end) : null,
    },
    items,
    assignedTickets: assignments.map((a) => ({ ticketNo: `TX-${a.ticket.number}`, title: a.ticket.title, at: a.assignedAt })),
    resolvedTickets: resolved.map((t) => ({ id: t.id, ticketNo: `TX-${t.number}`, title: t.title, at: t.resolvedAt, sla: t.slaState })),
  };
}

/** One row per technician for the same day (supervisor / admin team report). */
export async function teamDay(from: Date, to: Date) {
  const techs = await prisma.technician.findMany({ include: { user: { select: { name: true, active: true } } }, orderBy: { user: { name: 'asc' } } });
  const rows = await Promise.all(techs.map(async (t) => {
    const d = await technicianDay(t.id, from, to);
    return { technicianId: t.id, name: t.user.name, active: t.user.active, ...d.summary };
  }));
  return { range: { from, to }, rows };
}

/** Tickets created vs resolved per hour for the last N hours (dashboard chart). */
export async function throughput(hours: number) {
  const end = new Date(); end.setMinutes(0, 0, 0);
  const start = new Date(end.getTime() - (hours - 1) * 3_600_000);
  const [created, resolved] = await Promise.all([
    prisma.ticket.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
    prisma.ticket.findMany({ where: { resolvedAt: { gte: start } }, select: { resolvedAt: true } }),
  ]);
  const buckets = Array.from({ length: hours }, (_, i) => ({ hour: new Date(start.getTime() + i * 3_600_000).toISOString(), created: 0, resolved: 0 }));
  const idx = (d: Date) => Math.floor((d.getTime() - start.getTime()) / 3_600_000);
  for (const t of created) { const b = buckets[idx(t.createdAt)]; if (b) b.created++; }
  for (const t of resolved) { const b = t.resolvedAt ? buckets[idx(t.resolvedAt)] : undefined; if (b) b.resolved++; }
  return { buckets };
}
