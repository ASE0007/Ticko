import { AlertOctagon, CheckCircle2, Clock, UserPlus } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { Ticket } from '../api/types';
import { useData } from '../store/data';
import { isManager, useAuth } from '../store/auth';
import { PRIORITY_META } from '../lib/format';

const OPEN = new Set(['OPEN', 'DIAGNOSING', 'AWAITING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'VERIFYING', 'REOPENED']);
const TONE = { danger: 'border-danger/50 bg-danger/5 text-danger', warn: 'border-warn/50 bg-warn/5 text-warn', info: 'border-info/40 bg-info/5 text-info' };
const SEVERITY = { danger: 3, warn: 2, info: 1 } as const;

interface Item { ticket: Ticket; tone: keyof typeof TONE; reasons: string[]; assign: boolean }

/** Ranked list of what a supervisor should look at NOW: SLA trouble, unassigned work, overrunning steps. */
export function NeedsAttention({ onAssign }: { onAssign: (t: Ticket) => void }) {
  const tickets = useData((s) => s.tickets);
  const steps = useData((s) => s.steps);
  const manager = isManager(useAuth((s) => s.user));

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const t of Object.values(tickets)) {
      if (!OPEN.has(t.status)) continue;
      const reasons: string[] = [];
      let tone: Item['tone'] | null = null;
      const bump = (x: Item['tone']) => { if (!tone || SEVERITY[x] > SEVERITY[tone]) tone = x; };
      if (t.slaState === 'BREACHED') { reasons.push('SLA breached'); bump('danger'); }
      else if (t.slaState === 'WARNING') { reasons.push('SLA warning'); bump('warn'); }
      else if (t.slaState === 'AT_RISK') { reasons.push('Predicted to miss SLA'); bump('info'); }
      const unassigned = t.status === 'AWAITING_ASSIGNMENT' || t.status === 'REOPENED';
      if (unassigned) { reasons.push(t.status === 'REOPENED' ? 'Reopened by customer' : 'Waiting for a technician'); bump(t.priority === 'CRITICAL' || t.priority === 'HIGH' ? 'warn' : 'info'); }
      const over = (steps[t.id] ?? []).filter((s) => s.status === 'IN_PROGRESS' && s.overrun);
      if (over[0]) { reasons.push(`Step over estimate: ${over[0].title}`); bump(over[0].overrunLevel >= 3 ? 'danger' : 'warn'); }
      if (tone) out.push({ ticket: t, tone, reasons, assign: unassigned });
    }
    const rank = Object.keys(PRIORITY_META);
    return out.sort((a, b) => SEVERITY[b.tone] - SEVERITY[a.tone] || rank.indexOf(b.ticket.priority) - rank.indexOf(a.ticket.priority)).slice(0, 7);
  }, [tickets, steps]);

  return (
    <section className="card flex flex-col p-4" aria-label="Needs attention">
      <header className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><AlertOctagon className="h-4 w-4 text-warn" />Needs attention</h2><span className="chip border-line mono text-mute">{items.length}</span></header>
      {items.length === 0 ? (
        <div className="m-auto flex flex-col items-center gap-2 py-8 text-center"><CheckCircle2 className="h-9 w-9 text-ok" /><p className="text-sm font-medium">All clear</p><p className="text-xs text-mute">No SLA risks, unassigned or overrunning work.</p></div>
      ) : (
        <ul className="space-y-2">
          {items.map(({ ticket: t, tone, reasons, assign }) => (
            <li key={t.id} className={clsx('rounded-lg border p-2.5', TONE[tone])}>
              <div className="flex items-start justify-between gap-2">
                <Link to={`/tickets/${t.id}`} className="min-w-0 text-ink hover:underline"><span className="mono text-xs font-bold">{t.ticketNo}</span> <span className="text-sm font-medium">{t.title}</span></Link>
                {assign && manager && <button className="btn-primary !px-2 !py-1 text-[11px]" onClick={() => onAssign(t)}><UserPlus className="h-3 w-3" />Assign</button>}
              </div>
              <p className="mt-1 flex items-start gap-1 text-[11px] text-ink/80"><Clock className="mt-0.5 h-3 w-3 shrink-0" />{reasons.join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
