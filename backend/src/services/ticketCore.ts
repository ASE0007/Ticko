import type { HistoryEntity, Prisma, TicketStatus } from '@prisma/client';
import { prisma, type Db } from '../repositories/prisma';
import { Errors } from '../utils/errors';
import { clock } from '../utils/clock';
import { assertTransition } from '../domain/ticketStateMachine';
import { computeForecast, type ForecastStep, type Forecast } from '../domain/forecast';
import { computeProgress } from '../domain/progress';
import { evaluateSla, mergeSla } from '../domain/sla';
import { getPolicy } from './slaPolicy';
import { emitTicketEvent, emitToStaffAndTicket } from '../realtime/events';
import { loadTicket, toTicketDTO } from './views';
import type { SlaState } from '@prisma/client';

/** Row-lock the ticket for the rest of the transaction: serialises concurrent writers. */
export async function lockTicket(tx: Db, id: string) {
  const rows = await tx.$queryRaw<{ id: string; status: TicketStatus; version: number; technician_id: string | null }[]>`
    SELECT id, status, version, technician_id FROM tickets WHERE id = ${id}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw Errors.notFound('Ticket');
  return { id: row.id, status: row.status, version: row.version, technicianId: row.technician_id };
}

export interface HistoryInput {
  ticketId: string;
  entity: HistoryEntity;
  entityId?: string | null;
  from?: string | null;
  to: string;
  message?: string | null;
  actorId?: string | null;
}

export async function addHistory(tx: Db, h: HistoryInput) {
  await tx.statusHistory.create({
    data: {
      ticketId: h.ticketId,
      entity: h.entity,
      entityId: h.entityId ?? null,
      fromValue: h.from ?? null,
      toValue: h.to,
      message: h.message ?? null,
      actorId: h.actorId ?? null,
      createdAt: clock.now(),
    },
  });
}

export interface TransitionOptions {
  /** optimistic lock: reject if the caller saw an older version (BR-16) */
  version?: number;
  data?: Prisma.TicketUncheckedUpdateInput;
  actorId?: string | null;
  message?: string;
}

/** The ONLY way a ticket changes status: lock -> check -> update -> audit. */
export async function applyTransition(tx: Db, ticketId: string, to: TicketStatus, o: TransitionOptions = {}) {
  const cur = await lockTicket(tx, ticketId);
  if (o.version !== undefined && cur.version !== o.version) throw Errors.versionConflict();
  assertTransition(cur.status, to);
  await tx.ticket.update({
    where: { id: ticketId },
    data: { ...(o.data ?? {}), status: to, version: { increment: 1 } },
  });
  await addHistory(tx, {
    ticketId, entity: 'TICKET', entityId: ticketId, from: cur.status, to,
    message: o.message ?? null, actorId: o.actorId ?? null,
  });
  return { from: cur.status, to };
}

export interface DerivedResult {
  changed: boolean;
  forecast: Forecast;
  slaTransition: { from: SlaState; to: SlaState } | null;
  ticketId: string;
}

/**
 * Recompute everything that is DERIVED from steps/time: forecast, totals, progress, SLA state.
 * Does not bump `version` (users editing a form must not get spurious conflicts).
 */
export async function refreshDerived(db: Db, ticketId: string, opts: { jobProgress?: number } = {}): Promise<DerivedResult> {
  const t = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { steps: { include: { dependencies: true } } },
  });
  if (!t) throw Errors.notFound('Ticket');

  const fSteps: ForecastStep[] = t.steps.map((s) => ({
    id: s.id, status: s.status, estimatedMinutes: s.estimatedMinutes, actualMinutes: s.actualMinutes,
    startedAt: s.startedAt, dependsOn: s.dependencies.map((d) => d.dependsOnId),
  }));
  const now = clock.now();
  const forecast = computeForecast(fSteps, clock, now);
  const finished = t.status === 'RESOLVED' || t.status === 'CLOSED' || t.status === 'CANCELLED';
  const forecastFinish = finished ? null : forecast.forecastFinish;

  let jobProgress = opts.jobProgress;
  if (jobProgress === undefined && (t.status === 'DIAGNOSING' || t.status === 'VERIFYING')) {
    const j = await db.job.findFirst({ where: { ticketId, status: { in: ['RUNNING', 'QUEUED'] } }, orderBy: { createdAt: 'desc' }, select: { progress: true } });
    jobProgress = j?.progress ?? 0;
  }
  const progress = computeProgress(t.status, t.steps, jobProgress ?? 0);

  const policy = await getPolicy(t.priority);
  const evaluated = evaluateSla({ now, createdAt: t.slaStartedAt, deadline: t.slaDeadline, warningPct: policy.warningPct, forecastFinish, status: t.status, resolvedAt: t.resolvedAt });
  const slaState = finished ? evaluated : mergeSla(t.slaState, evaluated);

  const driftMs = Math.max(60_000 / clock.scale, 2000);
  const forecastChanged =
    (t.forecastFinish === null) !== (forecastFinish === null) ||
    (t.forecastFinish && forecastFinish && Math.abs(t.forecastFinish.getTime() - forecastFinish.getTime()) >= driftMs);
  const changed =
    Boolean(forecastChanged) || progress !== t.progress || forecast.estimatedTotalMin !== t.estimatedTotalMin ||
    forecast.actualTotalMin !== t.actualTotalMin || slaState !== t.slaState;

  if (changed) {
    await db.ticket.update({
      where: { id: ticketId },
      data: { forecastFinish, progress, slaState, estimatedTotalMin: forecast.estimatedTotalMin, actualTotalMin: forecast.actualTotalMin },
    });
  }
  return { changed, forecast, ticketId, slaTransition: slaState !== t.slaState ? { from: t.slaState, to: slaState } : null };
}

/** Load the fresh ticket and push it to every interested audience. */
export async function publishTicket(ticketId: string, type: string, extra: Record<string, unknown> = {}, opts?: { includeTrack?: boolean }) {
  const row = await loadTicket(ticketId);
  emitTicketEvent(type, toTicketDTO(row), row, extra, opts);
  return row;
}

/** Refresh derived fields and publish what changed (used after step events and by the scheduler). */
export async function refreshAndPublish(ticketId: string, opts: { force?: boolean; jobProgress?: number } = {}) {
  const r = await refreshDerived(prisma, ticketId, opts.jobProgress !== undefined ? { jobProgress: opts.jobProgress } : {});
  if (r.slaTransition) {
    const row = await publishTicket(ticketId, 'ticket.updated', { reason: 'sla' });
    const type = r.slaTransition.to === 'AT_RISK' ? 'sla.at_risk' : r.slaTransition.to === 'WARNING' ? 'sla.warning' : r.slaTransition.to === 'BREACHED' ? 'sla.breached' : null;
    if (type) {
      await addHistory(prisma, { ticketId, entity: 'SYSTEM', from: r.slaTransition.from, to: r.slaTransition.to, message: `SLA ${r.slaTransition.to.toLowerCase().replace('_', ' ')}` });
      emitToStaffAndTicket(type, ticketId, { ticketId, ticketNo: `TX-${row.number}`, slaState: r.slaTransition.to, deadline: row.slaDeadline });
    }
  } else if (r.changed || opts.force) {
    await publishTicket(ticketId, 'forecast.updated', {
      forecast: { finish: r.forecast.forecastFinish, estimatedTotalMin: r.forecast.estimatedTotalMin, actualTotalMin: r.forecast.actualTotalMin, steps: r.forecast.steps },
    });
  }
  return r;
}
