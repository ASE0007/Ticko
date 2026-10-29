import clsx from 'clsx';
import type { Priority, SlaState, StepStatus, TicketStatus } from '../api/types';
import { PRIORITY_META, SLA_META, STATUS_META, STEP_META, initials } from '../lib/format';

export const StatusBadge = ({ status }: { status: TicketStatus }) => (
  <span className={clsx('chip', STATUS_META[status].cls)}>{STATUS_META[status].label}</span>
);

export const PriorityBadge = ({ priority, escalated }: { priority: Priority; escalated?: boolean }) => (
  <span className={clsx('chip', PRIORITY_META[priority].cls)} title={escalated ? 'Auto-escalated by SLA' : undefined}>
    <span className={clsx('h-1.5 w-1.5 rounded-full', PRIORITY_META[priority].dot)} />
    {PRIORITY_META[priority].label}
    {escalated && <span aria-label="escalated">▲</span>}
  </span>
);

export const SlaBadge = ({ state }: { state: SlaState }) => (
  <span className={clsx('chip border-current/30', SLA_META[state].cls)}>SLA · {SLA_META[state].label}</span>
);

export const StepBadge = ({ status }: { status: StepStatus }) => (
  <span className={clsx('chip', STEP_META[status].cls)}>{STEP_META[status].label}</span>
);

export const Avatar = ({ name, size = 28 }: { name: string; size?: number }) => (
  <span
    className="inline-grid shrink-0 place-items-center rounded-full bg-brand/15 font-semibold text-brand"
    style={{ width: size, height: size, fontSize: size * 0.38 }}
    title={name}
    aria-label={name}
  >
    {initials(name)}
  </span>
);
