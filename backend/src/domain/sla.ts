import type { SlaState, TicketStatus } from '@prisma/client';

export interface SlaInput {
  now: Date;
  createdAt: Date;
  deadline: Date;
  warningPct: number;
  forecastFinish: Date | null;
  status: TicketStatus;
  resolvedAt: Date | null;
}

/**
 * ON_TRACK -> AT_RISK (predicted breach) -> WARNING (time threshold) -> BREACHED.
 * After RESOLVED the SLA clock stops: the outcome is frozen.
 */
export function evaluateSla(i: SlaInput): SlaState {
  if (i.status === 'CANCELLED') return 'ON_TRACK';
  if (i.resolvedAt && (i.status === 'RESOLVED' || i.status === 'CLOSED')) {
    return i.resolvedAt > i.deadline ? 'BREACHED' : 'ON_TRACK';
  }
  if (i.now > i.deadline) return 'BREACHED';
  const total = i.deadline.getTime() - i.createdAt.getTime();
  const used = i.now.getTime() - i.createdAt.getTime();
  if (total > 0 && (used / total) * 100 >= i.warningPct) return 'WARNING';
  if (i.forecastFinish && i.forecastFinish > i.deadline) return 'AT_RISK';
  return 'ON_TRACK';
}

const RANK: Record<SlaState, number> = { ON_TRACK: 0, AT_RISK: 1, WARNING: 2, BREACHED: 3 };

/** WARNING and BREACHED never regress while the ticket is open. */
export function mergeSla(prev: SlaState, next: SlaState): SlaState {
  if (RANK[prev] >= 2 && RANK[next] < RANK[prev]) return prev;
  return next;
}
