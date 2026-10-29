import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useMemo } from 'react';
import clsx from 'clsx';
import type { Ticket, TicketStatus } from '../api/types';
import { TicketCard } from './TicketCard';
import { PRIORITY_META } from '../lib/format';

export const COLUMNS: { key: string; title: string; statuses: TicketStatus[]; accent: string }[] = [
  { key: 'intake', title: 'Intake & diagnostics', statuses: ['OPEN', 'DIAGNOSING'], accent: 'bg-info' },
  { key: 'assign', title: 'Needs assignment', statuses: ['AWAITING_ASSIGNMENT', 'REOPENED'], accent: 'bg-warn' },
  { key: 'field', title: 'In the field', statuses: ['ASSIGNED', 'IN_PROGRESS'], accent: 'bg-brand' },
  { key: 'verify', title: 'Verifying speed', statuses: ['VERIFYING'], accent: 'bg-info' },
  { key: 'done', title: 'Resolved · awaiting customer', statuses: ['RESOLVED'], accent: 'bg-ok' },
];

const RANK = Object.keys(PRIORITY_META);
const byUrgency = (a: Ticket, b: Ticket) => RANK.indexOf(b.priority) - RANK.indexOf(a.priority) || a.createdAt.localeCompare(b.createdAt);

/** Live board: cards glide between columns (shared-layout animation) as server events arrive. */
export function KanbanBoard({ tickets, onAssign }: { tickets: Ticket[]; onAssign: (t: Ticket) => void }) {
  const cols = useMemo(
    () => COLUMNS.map((c) => ({ ...c, items: tickets.filter((t) => c.statuses.includes(t.status)).sort(byUrgency) })),
    [tickets],
  );
  return (
    <LayoutGroup>
      <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-3 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0" data-testid="kanban">
        {cols.map((c) => (
          <section key={c.key} className="min-w-[78vw] snap-center sm:min-w-[300px] lg:min-w-0" aria-label={c.title}>
            <header className="mb-2 flex items-center justify-between px-1">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-mute">
                <span className={clsx('h-2 w-2 rounded-full', c.accent)} />{c.title}
              </h2>
              <motion.span key={c.items.length} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="chip border-line mono text-mute">{c.items.length}</motion.span>
            </header>
            <div className="flex min-h-[120px] flex-col gap-2 rounded-xl border border-dashed border-line/60 bg-panel/30 p-2">
              <AnimatePresence mode="popLayout" initial={false}>
                {c.items.map((t) => <TicketCard key={t.id} ticket={t} onAssign={onAssign} />)}
              </AnimatePresence>
              {c.items.length === 0 && <p className="m-auto py-6 text-xs text-mute/70">Nothing here</p>}
            </div>
          </section>
        ))}
      </div>
    </LayoutGroup>
  );
}
