import { CheckCheck, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, get, post } from '../api/client';
import type { Page, Step, Ticket } from '../api/types';
import { useAuth } from '../store/auth';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { LoadMeter } from '../components/TechnicianCard';
import { PriorityBadge, StatusBadge } from '../components/Badges';
import { SlaRing } from '../components/Rings';
import { StepGantt } from '../components/StepGantt';

/** Technician home: only my tickets, big touch-friendly Start / Complete buttons. */
export default function MyWork() {
  const me = useAuth((s) => s.user)!;
  const all = useData((s) => s.tickets);
  const steps = useData((s) => s.steps);
  const tech = useData((s) => (me.technicianId ? s.technicians[me.technicianId] : undefined));
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    get<Page<Ticket>>('/tickets?status=ASSIGNED,IN_PROGRESS,VERIFYING&limit=50').then(async (r) => {
      useData.getState().setTickets(r.items);
      await Promise.all(r.items.map((t) => get<{ steps: Step[] }>(`/tickets/${t.id}/steps`).then((s) => useData.getState().setSteps(t.id, s.steps))));
    }).catch(() => undefined).finally(() => setLoaded(true));
  }, []);

  const mine = Object.values(all).filter((t) => ['ASSIGNED', 'IN_PROGRESS', 'VERIFYING'].includes(t.status) && (t.technician?.id === me.technicianId || steps[t.id]?.some((s) => s.assigneeId === me.technicianId)));

  const act = async (key: string, path: string) => {
    setBusy(key);
    try { await post(path); } catch (e) { useUi.getState().toast({ kind: 'warn', title: e instanceof ApiError ? e.message : 'Action failed' }); } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold">My work</h1><p className="text-sm text-mute">Hello {me.name.split(' ')[0]}, here is what is on your plate.</p></div>{tech && <LoadMeter active={tech.activeTickets} max={tech.maxActive} />}</div>
      {!loaded && <div className="skeleton h-40" />}
      {loaded && mine.length === 0 && <div className="card p-10 text-center"><p className="text-lg font-semibold">All clear 🎉</p><p className="text-sm text-mute">New assignments appear here instantly.</p></div>}
      {mine.map((t) => {
        const s = steps[t.id] ?? [];
        const allDone = s.length > 0 && s.every((x) => x.status === 'DONE' || x.status === 'SKIPPED');
        return (
          <article key={t.id} className="card space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-1.5"><span className="mono text-sm font-bold text-brand">{t.ticketNo}</span><PriorityBadge priority={t.priority} /><StatusBadge status={t.status} /></div><Link to={`/tickets/${t.id}`} className="block text-base font-semibold hover:text-brand">{t.title}</Link><p className="text-xs text-mute">{t.customer.name} · {t.customer.phone}<br />{t.customer.address}</p></div>
              <SlaRing state={t.slaState} startedAt={t.slaStartedAt} deadline={t.slaDeadline} size={52} />
            </div>
            <StepGantt steps={s} actions={(st) => (
              <div className="flex gap-1">
                {st.status === 'READY' && (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS') && <button className="btn-primary !px-3 !py-2" disabled={busy === st.id} onClick={() => act(st.id, `/steps/${st.id}/start`)}><Play className="h-4 w-4" />Start</button>}
                {st.status === 'IN_PROGRESS' && <button className="btn-primary !bg-ok !px-3 !py-2" disabled={busy === st.id} onClick={() => act(st.id, `/steps/${st.id}/complete`)}><CheckCheck className="h-4 w-4" />Done</button>}
              </div>
            )} />
            {t.status === 'IN_PROGRESS' && allDone && <button className="btn-primary w-full" disabled={busy === t.id} onClick={() => act(t.id, `/tickets/${t.id}/request-verification`)}>All steps done · request speed verification</button>}
            {t.status === 'VERIFYING' && <p className="rounded-lg border border-info/40 bg-info/5 p-2 text-center text-sm text-info">Automatic speed test running… you will be notified.</p>}
          </article>
        );
      })}
    </div>
  );
}
