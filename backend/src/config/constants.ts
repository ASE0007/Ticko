import type { Priority, TicketStatus } from '@prisma/client';

/** Lower number = processed first by the priority queue. */
export const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export const PRIORITY_ORDER: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Next higher priority used by SLA auto-escalation (BR-10). */
export function escalate(p: Priority): Priority {
  const i = PRIORITY_ORDER.indexOf(p);
  return PRIORITY_ORDER[Math.min(i + 1, PRIORITY_ORDER.length - 1)] as Priority;
}

export const TERMINAL_STATUSES: TicketStatus[] = ['CLOSED', 'CANCELLED'];

/** Tickets that still count against SLA / appear on the live board. */
export const OPEN_STATUSES: TicketStatus[] = [
  'OPEN',
  'DIAGNOSING',
  'AWAITING_ASSIGNMENT',
  'ASSIGNED',
  'IN_PROGRESS',
  'VERIFYING',
  'RESOLVED',
  'REOPENED',
];

/** Statuses in which a technician is occupied (counts toward capacity). */
export const TECH_OCCUPYING_STATUSES: TicketStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'VERIFYING'];

/** Overrun thresholds as multiples of the estimate (FR-24). */
export const OVERRUN_MULTIPLIERS = [1.0, 1.5, 2.0] as const;

export const JOB_RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
export const WS_REPLAY_BUFFER_SIZE = 1000;
