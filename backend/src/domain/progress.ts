import type { StepStatus, TicketStatus } from '@prisma/client';

/** Overall workflow progress 0..100 (diagnosis 15% / work 65% / verification 15% / close 5%). */
export function computeProgress(
  status: TicketStatus,
  steps: { status: StepStatus }[],
  jobProgress = 0,
): number {
  const frac = (n: number) => Math.max(0, Math.min(100, n)) / 100;
  switch (status) {
    case 'OPEN':
      return 0;
    case 'DIAGNOSING':
      return Math.round(15 * frac(jobProgress));
    case 'AWAITING_ASSIGNMENT':
    case 'REOPENED':
      return 15;
    case 'ASSIGNED':
      return 20;
    case 'IN_PROGRESS': {
      const counted = steps.filter((s) => s.status !== 'SKIPPED');
      const done = counted.filter((s) => s.status === 'DONE').length;
      return 20 + Math.round(60 * (counted.length ? done / counted.length : 0));
    }
    case 'VERIFYING':
      return 80 + Math.round(15 * frac(jobProgress));
    case 'RESOLVED':
      return 95;
    case 'CLOSED':
      return 100;
    default:
      return 0;
  }
}
