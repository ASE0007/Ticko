import { motion } from 'framer-motion';
import { UserPlus, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { Ticket } from '../api/types';
import { Avatar, PriorityBadge } from './Badges';
import { SlaRing } from './Rings';
import { useData, activeJobFor } from '../store/data';
import { useAuth, isManager } from '../store/auth';

const NEEDS_ASSIGN = new Set(['AWAITING_ASSIGNMENT', 'REOPENED']);
const SLA_CLOSED = new Set(['RESOLVED', 'CLOSED']);

export function TicketCard({ ticket: t, onAssign }: { ticket: Ticket; onAssign?: (t: Ticket) => void }) {
  const job = useData((s) => activeJobFor(s.jobs, t.id));
  const overrun = useData((s) => s.steps[t.id]?.some((x) => x.overrun && x.status === 'IN_PROGRESS'));
  const manager = isManager(useAuth((s) => s.user));
  const sla = t.slaState;
  return (
    <motion.article
      layout="position" layoutId={`card-${t.id}`}
      initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className={clsx('card group relative overflow-hidden p-3 transition-shadow hover:shadow-lg hover:shadow-brand/10',
        sla === 'BREACHED' && 'border-danger/60', sla === 'WARNING' && 'border-warn/50', t.priority === 'CRITICAL' && 'ring-1 ring-crit/40')}
    >
      <Link to={`/tickets/${t.id}`} className="absolute inset-0 z-0" aria-label={`Open ${t.ticketNo}`} />
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mono text-xs font-bold text-brand">{t.ticketNo}</span>
            <PriorityBadge priority={t.priority} escalated={t.escalated} />
            {t.reopenCount > 0 && <span className="chip border-crit/40 text-crit">↻ reopened</span>}
          </div>
          <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{t.title}</h3>
          <p className="mt-0.5 truncate text-xs text-mute">{t.customer.name} · {t.customer.area ?? t.categoryName}</p>
        </div>
        <SlaRing state={sla} startedAt={t.slaStartedAt} deadline={t.slaDeadline} closed={SLA_CLOSED.has(t.status)} size={42} />
      </div>

      <div className="pointer-events-none relative z-10 mt-2.5">
        {job ? (
          <div className="mb-1 flex items-center justify-between text-[11px] text-info">
            <span className="flex items-center gap-1 truncate"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />{job.stage ?? 'Working'}</span>
            <span className="mono">{job.progress}%</span>
          </div>
        ) : (
          <div className="mb-1 flex items-center justify-between text-[11px] text-mute">
            <span>{overrun ? <span className="font-semibold text-warn">⏱ step over estimate</span> : 'Progress'}</span>
            <span className="mono">{t.progress}%</span>
          </div>
        )}
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <motion.div className={clsx('h-full rounded-full', job ? 'bg-info' : overrun ? 'bg-warn' : 'bg-brand')} initial={false} animate={{ width: `${job ? job.progress : t.progress}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
        </div>
      </div>

      <div className="relative z-10 mt-2.5 flex items-center justify-between gap-2 text-xs">
        {t.technician ? (
          <span className="pointer-events-none flex min-w-0 items-center gap-1.5 text-mute"><Avatar name={t.technician.name} size={22} /><span className="truncate">{t.technician.name}</span></span>
        ) : NEEDS_ASSIGN.has(t.status) && manager && onAssign ? (
          <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => onAssign(t)}><UserPlus className="h-3.5 w-3.5" />Assign</button>
        ) : (
          <span className="pointer-events-none flex items-center gap-1 text-mute"><Wrench className="h-3.5 w-3.5" />{NEEDS_ASSIGN.has(t.status) ? 'Unassigned' : '—'}</span>
        )}
        {t.actualTotalMin > 0 && (
          <span className="pointer-events-none mono text-[11px] text-mute" title="Estimated vs actual work minutes">
            est {t.estimatedTotalMin}m · <span className={t.actualTotalMin > t.estimatedTotalMin ? 'text-warn' : 'text-ok'}>act {t.actualTotalMin}m</span>
          </span>
        )}
      </div>
    </motion.article>
  );
}
