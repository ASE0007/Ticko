import { motion } from 'framer-motion';
import { Coffee, Moon, Users } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { Step, Technician, Ticket } from '../api/types';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { useNow } from '../hooks/useNow';
import { fmtMinutes, simMinutes } from '../lib/format';
import { Avatar } from './Badges';
import { LoadMeter } from './TechnicianCard';

interface Work { step: Step; ticket: Ticket | undefined }

/** Live "who is doing what right now" board: one card per technician with the running step and its timer. */
export function FieldTeam() {
  const techMap = useData((s) => s.technicians);
  const stepsMap = useData((s) => s.steps);
  const tickets = useData((s) => s.tickets);
  const scale = useUi((s) => s.timeScale);
  const now = useNow(1000);

  const techs = useMemo(() => Object.values(techMap).sort((a, b) => a.name.localeCompare(b.name)), [techMap]);
  const working = useMemo(() => {
    const m = new Map<string, Work[]>();
    for (const list of Object.values(stepsMap)) {
      for (const st of list) {
        if (st.status !== 'IN_PROGRESS' || !st.assigneeId) continue;
        const arr = m.get(st.assigneeId) ?? [];
        arr.push({ step: st, ticket: tickets[st.ticketId] });
        m.set(st.assigneeId, arr);
      }
    }
    return m;
  }, [stepsMap, tickets]);
  const queued = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of Object.values(tickets)) if (t.technician && (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS' || t.status === 'VERIFYING')) m.set(t.technician.id, (m.get(t.technician.id) ?? 0) + 1);
    return m;
  }, [tickets]);

  return (
    <section className="card p-4" aria-label="Field team">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-brand" />Field team · live</h2>
        <Link to="/technicians" className="text-xs text-brand hover:underline">workload details →</Link>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {techs.map((t) => <TechCard key={t.id} tech={t} work={working.get(t.id) ?? []} tickets={queued.get(t.id) ?? 0} now={now} scale={scale} />)}
        {techs.length === 0 && <p className="col-span-full py-6 text-center text-sm text-mute">No technicians yet. An admin can add them in Users.</p>}
      </div>
    </section>
  );
}

function TechCard({ tech, work, tickets, now, scale }: { tech: Technician; work: Work[]; tickets: number; now: number; scale: number }) {
  const off = tech.availability === 'OFF_DUTY';
  return (
    <motion.article layout className={clsx('rounded-xl border p-3', work.length ? 'border-brand/40 bg-brand/5' : 'border-line bg-panel2/40', off && 'opacity-60')}>
      <div className="flex items-center gap-2.5">
        <div className="relative"><Avatar name={tech.name} size={34} /><span className={clsx('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel', off ? 'bg-mute' : work.length ? 'bg-brand' : 'bg-ok')} /></div>
        <div className="min-w-0 flex-1"><Link to={`/tickets?technicianId=${tech.id}`} className="block truncate text-sm font-semibold hover:text-brand hover:underline" title={`Show tickets of ${tech.name}`}>{tech.name}</Link><p className="truncate text-[11px] text-mute">{tech.skills.join(' · ')}</p></div>
        <LoadMeter active={tech.activeTickets} max={tech.maxActive} />
      </div>
      <div className="mt-2.5 space-y-2">
        {work.map(({ step, ticket }) => {
          const el = step.startedAt ? simMinutes(step.startedAt, now, scale) : 0;
          const over = Math.max(0, el - step.estimatedMinutes);
          const max = Math.max(step.estimatedMinutes, el) * 1.05;
          return (
            <div key={step.id} className="rounded-lg bg-bg/40 p-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <Link to={`/tickets/${step.ticketId}`} className="min-w-0 truncate hover:text-brand"><span className="mono font-bold text-brand">{ticket?.ticketNo ?? ''}</span> {step.title}</Link>
                {over > 0 && <span className="chip shrink-0 animate-pulse border-warn/50 bg-warn/10 text-warn">⏱ +{fmtMinutes(over)}</span>}
              </div>
              <div className="relative mt-1.5 h-2 rounded bg-line/60" aria-label={`${fmtMinutes(el)} of ${fmtMinutes(step.estimatedMinutes)} estimated`}>
                <div className="absolute inset-y-0 left-0 rounded border border-dashed border-mute/60" style={{ width: `${(step.estimatedMinutes / max) * 100}%` }} />
                <motion.div className="absolute inset-y-0 left-0 rounded-l bg-ok/80" initial={false} animate={{ width: `${(Math.min(el, step.estimatedMinutes) / max) * 100}%` }} transition={{ ease: 'linear', duration: 0.6 }} />
                <motion.div className="hatch absolute inset-y-0 rounded-r bg-danger" initial={false} animate={{ left: `${(step.estimatedMinutes / max) * 100}%`, width: `${(over / max) * 100}%` }} transition={{ ease: 'linear', duration: 0.6 }} />
              </div>
              <p className="mono mt-1 text-[10px] text-mute">{fmtMinutes(el)} / est {fmtMinutes(step.estimatedMinutes)}</p>
            </div>
          );
        })}
        {work.length === 0 && (
          <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-xs text-mute">
            {off ? <><Moon className="h-3.5 w-3.5" />Off duty</> : <><Coffee className="h-3.5 w-3.5" />{tickets > 0 ? `${tickets} ticket${tickets > 1 ? 's' : ''} assigned, nothing started yet` : 'Idle · ready for work'}</>}
          </p>
        )}
      </div>
    </motion.article>
  );
}
