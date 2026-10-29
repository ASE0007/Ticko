import type { TicketStatus } from '@prisma/client';
import { Errors } from '../utils/errors';

/** Allowed ticket transitions (see docs/02-system-design.md, section 5.1). */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['DIAGNOSING', 'AWAITING_ASSIGNMENT', 'CANCELLED'],
  DIAGNOSING: ['AWAITING_ASSIGNMENT', 'CANCELLED'],
  AWAITING_ASSIGNMENT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['VERIFYING', 'CANCELLED'],
  VERIFYING: ['RESOLVED', 'IN_PROGRESS', 'CANCELLED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['ASSIGNED', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) throw Errors.invalidTransition(from, to);
}

/** Statuses from which `to` is reachable (used for guarded UPDATE ... WHERE status IN (...)). */
export function sourcesOf(to: TicketStatus): TicketStatus[] {
  return (Object.keys(TRANSITIONS) as TicketStatus[]).filter((s) => TRANSITIONS[s].includes(to));
}
