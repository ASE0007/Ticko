import { motion } from 'framer-motion';
import { AlertOctagon, CheckCheck, Cpu, Inbox, Plus, Ticket as TicketIcon, Users, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { Ticket } from '../api/types';
import { useData } from '../store/data';
import { isManager, useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { KanbanBoard } from '../components/KanbanBoard';
import { AssignDialog } from '../components/AssignDialog';
import { WorkerPool } from '../components/WorkerPool';
import { ActivityFeed } from '../components/ActivityFeed';
import { FieldTeam } from '../components/FieldTeam';
import { NeedsAttention } from '../components/NeedsAttention';
import { ThroughputChart } from '../components/MiniBars';
import { OPEN_STATUSES } from '../lib/format';

/** A card that is a real link (or a scroll button): clicking it opens exactly the list behind the number. */
function Kpi({ icon: Icon, label, value, suffix, tone, sub, pulse, to, scrollTo }: { icon: typeof Inbox; label: string; value: number; suffix?: string; tone: string; sub: string; pulse?: boolean; to?: string; scrollTo?: string }) {
  const body = (
    <>
      <span aria-hidden className={clsx('absolute inset-x-0 top-0 h-0.5 opacity-80', tone.replace('text-', 'bg-'))} />
      <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wide text-mute">{label}</span><span className={clsx('grid h-7 w-7 place-items-center rounded-lg bg-current/10', tone)}><Icon className="h-4 w-4" /></span></div>
      <p className={clsx('mt-1.5 text-3xl font-bold leading-none mono', tone)}><AnimatedNumber value={value} suffix={suffix ?? ''} /></p>
      <p className="mt-1.5 truncate text-[11px] text-mute">{sub}</p>
      {pulse && <span className="absolute right-3 top-3 h-2 w-2 animate-ping rounded-full bg-danger" />}
    </>
  );
  const cls = clsx('card relative block w-full overflow-hidden p-3.5 text-left transition hover:border-brand/60 hover:bg-panel2/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand', pulse && 'border-danger/50');
  return (
    <motion.div layout>
      {to ? <Link to={to} className={cls} aria-label={`${label}: ${value}${suffix ?? ''}. Open the list`}>{body}</Link>
        : <button type="button" className={cls} onClick={() => document.getElementById(scrollTo ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label={`${label}: ${value}${suffix ?? ''}. Show details`}>{body}</button>}
    </motion.div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const me = useAuth((s) => s.user);
  const tickets = useData((s) => s.tickets);
  const metrics = useData((s) => s.metrics);
  const loaded = useData((s) => s.loaded);
  const online = useData((s) => s.online);
  const scale = useUi((s) => s.timeScale);
  const manager = isManager(me);
  const [assigning, setAssigning] = useState<Ticket | null>(null);

  const open = useMemo(() => Object.values(tickets).filter((t) => OPEN_STATUSES.includes(t.status)), [tickets]);
  const needAssign = open.filter((t) => t.status === 'AWAITING_ASSIGNMENT' || t.status === 'REOPENED').length;
  const atRisk = open.filter((t) => t.slaState === 'AT_RISK' || t.slaState === 'WARNING').length;
  const breached = open.filter((t) => t.slaState === 'BREACHED').length;

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-brand/15 via-panel to-panel p-5">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-brand/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-mute">{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="text-2xl font-bold tracking-tight">{greeting()}, {me?.name.split(' ').slice(-1)[0] ?? 'team'} 👋</h1>
            <p className="mt-0.5 text-sm text-mute">Live view of every ticket, technician and background worker. Everything updates the moment it happens.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {scale > 1 && <span className="chip border-warn/40 bg-warn/10 text-warn"><Zap className="h-3 w-3" />Demo clock ×{scale}</span>}
            <span className="chip border-line text-mute">{online.length} online</span>
            <button className="btn-primary" onClick={() => useUi.getState().openNewTicket(true)}><Plus className="h-4 w-4" />New ticket</button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={TicketIcon} label="Open tickets" value={open.length} tone="text-brand" sub={`${metrics?.tickets.createdLast24h ?? 0} filed in 24h`} to={`/tickets?status=${OPEN_STATUSES.join(',')}`} />
        <Kpi icon={Inbox} label="Needs assignment" value={needAssign} tone={needAssign ? 'text-warn' : 'text-ok'} sub={needAssign ? 'waiting for a supervisor' : 'everything assigned'} to="/tickets?status=AWAITING_ASSIGNMENT,REOPENED" />
        <Kpi icon={AlertOctagon} label="SLA risk" value={atRisk + breached} tone={breached ? 'text-danger' : atRisk ? 'text-warn' : 'text-ok'} sub={`${atRisk} at risk · ${breached} breached`} pulse={breached > 0} to={`/tickets?sla=AT_RISK,WARNING,BREACHED&status=${OPEN_STATUSES.join(',')}`} />
        <Kpi icon={CheckCheck} label="Resolved (24h)" value={metrics?.tickets.resolvedLast24h ?? 0} tone="text-ok" sub="verified by speed test" to="/tickets?status=RESOLVED,CLOSED&sort=updatedAt" />
        <Kpi icon={Cpu} label="Workers busy" value={metrics?.queue.utilisation ?? 0} suffix="%" tone="text-info" sub={`${metrics?.queue.running ?? 0}/${metrics?.queue.concurrency ?? '–'} running · ${metrics?.queue.queued ?? 0} queued`} {...(manager ? { to: '/jobs' } : { scrollTo: 'worker-pool' })} />
        <Kpi icon={Users} label="Technician load" value={metrics?.technicians.utilisationPct ?? 0} suffix="%" tone="text-brand" sub={`${metrics?.technicians.activeTickets ?? 0}/${metrics?.technicians.capacity ?? 0} slots used`} to="/technicians" />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8"><FieldTeam /></div>
        <div className="xl:col-span-4"><NeedsAttention onAssign={setAssigning} /></div>
      </div>

      <section aria-label="Live ticket board">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Live ticket board</h2><span className="text-xs text-mute">cards move by themselves as work progresses</span></div>
        {!loaded ? (
          <div className="grid gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-56" />)}</div>
        ) : open.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand/15 text-brand"><TicketIcon className="h-7 w-7" /></span>
            <h3 className="text-lg font-semibold">No open tickets yet</h3>
            <p className="max-w-md text-sm text-mute">Create the first ticket and watch it get diagnosed, assigned and worked live. For a lively demo run <code className="mono rounded bg-panel2 px-1.5 py-0.5 text-xs">npm run demo:traffic</code> in the backend folder.</p>
            <button className="btn-primary" onClick={() => useUi.getState().openNewTicket(true)}><Plus className="h-4 w-4" />Create ticket</button>
          </div>
        ) : (
          <KanbanBoard tickets={open} onAssign={setAssigning} />
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5"><ThroughputChart /></div>
        <div id="worker-pool" className="scroll-mt-20 xl:col-span-3"><WorkerPool /></div>
        <div className="xl:col-span-4"><ActivityFeed /></div>
      </div>
      <AssignDialog ticket={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}
