import { motion } from 'framer-motion';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import type { Availability, Technician } from '../api/types';
import { Avatar } from './Badges';

const AV: Record<Availability, { label: string; cls: string }> = {
  AVAILABLE: { label: 'Available', cls: 'bg-ok' },
  BUSY: { label: 'Busy', cls: 'bg-warn' },
  OFF_DUTY: { label: 'Off duty', cls: 'bg-mute' },
};

/** Workload meter: one segment per allowed active ticket (BR-02). */
export function LoadMeter({ active, max }: { active: number; max: number }) {
  return (
    <div className="flex items-center gap-1" role="meter" aria-valuenow={active} aria-valuemin={0} aria-valuemax={max} aria-label={`${active} of ${max} active tickets`}>
      {Array.from({ length: max }, (_, i) => (
        <motion.span key={i} initial={false} animate={{ scaleY: i < active ? 1 : 0.55, opacity: i < active ? 1 : 0.35 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className={clsx('h-3 w-6 origin-bottom rounded-sm', i < active ? (active >= max ? 'bg-danger' : 'bg-brand') : 'bg-line')} />
      ))}
      {active >= max && <span className="chip ml-1 border-danger/40 text-danger">FULL</span>}
    </div>
  );
}

export function TechnicianCard({ tech, compact = false }: { tech: Technician; compact?: boolean }) {
  const av = AV[tech.availability];
  return (
    <div className={clsx('card flex flex-col gap-2', compact ? 'p-2.5' : 'p-4')}>
      <div className="flex items-center gap-2.5">
        <div className="relative"><Avatar name={tech.name} size={compact ? 30 : 38} /><span className={clsx('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel', av.cls)} title={av.label} /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tech.name}</p>
          <p className="truncate text-[11px] text-mute">{tech.skills.join(' · ')}</p>
        </div>
        <LoadMeter active={tech.activeTickets} max={tech.maxActive} />
      </div>
      {!compact && (
        <ul className="space-y-1.5">
          {(tech.currentTickets ?? []).map((c) => (
            <li key={c.id}>
              <Link to={`/tickets/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-panel2 px-2.5 py-1.5 text-xs hover:ring-1 hover:ring-brand/50">
                <span className="truncate"><span className="mono font-bold text-brand">{c.ticketNo}</span> {c.title}</span>
                <span className="mono shrink-0 text-mute">{c.progress}%</span>
              </Link>
            </li>
          ))}
          {(tech.currentTickets ?? []).length === 0 && <li className="rounded-lg border border-dashed border-line px-2.5 py-2 text-center text-xs text-mute">No active tickets</li>}
        </ul>
      )}
    </div>
  );
}
