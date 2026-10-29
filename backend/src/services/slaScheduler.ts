import { prisma } from '../repositories/prisma';
import { env } from '../config/env';
import { clock } from '../utils/clock';
import { logger } from '../utils/logger';
import { escalate, OPEN_STATUSES } from '../config/constants';
import { evaluateSla } from '../domain/sla';
import { addHistory, publishTicket, refreshAndPublish } from './ticketCore';
import { detectOverruns } from './stepService';
import { closeTicket } from './ticketService';
import { getPolicy } from './slaPolicy';
import { getMetrics } from './metricsService';
import { bus, rooms } from '../realtime/eventBus';

/**
 * One cheap tick loop: step overruns, SLA states, auto-escalation, auto-close, live metrics.
 * Everything is indexed/bounded; a tick never overlaps the previous one.
 */
export class SlaScheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastMetrics = '';

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), env.SCHEDULER_TICK_MS);
    this.timer.unref();
    logger.info({ tickMs: env.SCHEDULER_TICK_MS }, 'SLA scheduler started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await detectOverruns();
      await this.evaluateOpenTickets();
      await this.escalate();
      await this.autoClose();
      await this.publishMetrics();
    } catch (err) {
      logger.error({ err }, 'Scheduler tick failed');
    } finally {
      this.busy = false;
    }
  }

  private async evaluateOpenTickets(): Promise<void> {
    const now = clock.now();
    const open = await prisma.ticket.findMany({
      where: { status: { in: OPEN_STATUSES.filter((s) => s !== 'RESOLVED') } },
      select: { id: true, status: true, priority: true, slaState: true, slaStartedAt: true, slaDeadline: true, forecastFinish: true, resolvedAt: true },
    });
    for (const t of open) {
      // Tickets with live work always refresh (forecast drifts while steps wait).
      if (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS') {
        await refreshAndPublish(t.id);
        continue;
      }
      const p = await getPolicy(t.priority);
      const next = evaluateSla({ now, createdAt: t.slaStartedAt, deadline: t.slaDeadline, warningPct: p.warningPct, forecastFinish: t.forecastFinish, status: t.status, resolvedAt: t.resolvedAt });
      if (next !== t.slaState && (next === 'WARNING' || next === 'BREACHED' || (next === 'AT_RISK' && t.slaState === 'ON_TRACK'))) {
        await refreshAndPublish(t.id);
      }
    }
  }

  /** BR-10: priority goes up one level once when SLA reaches WARNING/BREACHED. */
  private async escalate(): Promise<void> {
    const due = await prisma.ticket.findMany({
      where: { escalated: false, slaState: { in: ['WARNING', 'BREACHED'] }, status: { in: OPEN_STATUSES.filter((s) => s !== 'RESOLVED') } },
      select: { id: true, priority: true },
    });
    for (const t of due) {
      const to = escalate(t.priority);
      const res = await prisma.ticket.updateMany({ where: { id: t.id, escalated: false }, data: { escalated: true, ...(to !== t.priority ? { priority: to } : {}), version: { increment: 1 } } });
      if (res.count === 0) continue;
      await addHistory(prisma, { ticketId: t.id, entity: 'SYSTEM', from: t.priority, to, message: to !== t.priority ? `Priority auto-escalated ${t.priority} -> ${to} (SLA warning)` : 'SLA warning at highest priority' });
      await publishTicket(t.id, 'ticket.updated', { reason: 'escalated', from: t.priority, to });
    }
  }

  private async autoClose(): Promise<void> {
    const cutoff = new Date(clock.now().getTime() - (env.AUTO_CLOSE_HOURS * 3_600_000) / clock.scale);
    const stale = await prisma.ticket.findMany({ where: { status: 'RESOLVED', resolvedAt: { lt: cutoff } }, select: { id: true }, take: 20 });
    for (const t of stale) await closeTicket(t.id, null, 'auto').catch((e) => logger.warn({ err: e }, 'auto-close failed'));
  }

  private async publishMetrics(): Promise<void> {
    const m = await getMetrics();
    const { ts: _ts, ...rest } = m;
    const sig = JSON.stringify(rest);
    if (sig === this.lastMetrics) return;
    this.lastMetrics = sig;
    bus.publish('metrics.updated', [{ room: rooms.staff, payload: { metrics: m } }]);
  }
}

export const scheduler = new SlaScheduler();
