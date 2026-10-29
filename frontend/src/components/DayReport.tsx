import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ApiError, get } from '../api/client';
import type { DayItem, DayReport as Report } from '../api/types';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { dayRange, fmtClock, fmtMinutes, toLocalDateInput } from '../lib/format';
import { Avatar } from './Badges';

export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const shift = (n: number) => { const [y, m, d] = date.split('-').map(Number) as [number, number, number]; onChange(toLocalDateInput(new Date(y, m - 1, d + n))); };
  const today = toLocalDateInput(new Date());
  return (
    <div className="no-print flex items-center gap-1.5">
      <button className="btn-ghost !p-2" onClick={() => shift(-1)} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
      <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Report date" />
      <button className="btn-ghost !p-2" onClick={() => shift(1)} disabled={date >= today} aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
      {date !== today && <button className="btn-ghost text-xs" onClick={() => onChange(today)}>Today</button>}
    </div>
  );
}

function Tile({ label, value, sub, tone = 'text-ink' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return <div className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-mute">{label}</p><p className={clsx('mt-1 text-2xl font-bold mono', tone)}>{value}</p>{sub && <p className="mt-0.5 text-[11px] text-mute">{sub}</p>}</div>;
}

/** 24-hour strip: every block is one work step (green = within estimate, red hatch = over, blue = running). */
export function DayTimeline({ items, date }: { items: DayItem[]; date: string }) {
  const { from } = dayRange(date);
  const start = new Date(from).getTime();
  const DAY = 86_400_000;
  const nowMs = Date.now();
  const lanes: number[] = [];
  const blocks = items.map((i) => {
    const s = Math.max(new Date(i.startedAt).getTime(), start);
    const e = Math.min(i.completedAt ? new Date(i.completedAt).getTime() : nowMs, start + DAY);
    let lane = lanes.findIndex((end) => end <= s);
    if (lane === -1) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
    return { i, left: ((s - start) / DAY) * 100, width: Math.max(0.5, ((e - s) / DAY) * 100), lane };
  });
  const laneCount = Math.max(1, lanes.length);
  return (
    <div className="card p-4" data-testid="day-timeline">
      <h3 className="mb-2 text-sm font-semibold">Day timeline</h3>
      <div className="relative" style={{ height: laneCount * 26 + 22 }}>
        {Array.from({ length: 25 }, (_, h) => (
          <div key={h} className="absolute top-0 bottom-5 border-l border-line/50" style={{ left: `${(h / 24) * 100}%` }}>{h % 3 === 0 && h < 24 && <span className="absolute -bottom-5 -translate-x-1/2 text-[9px] text-mute">{String(h).padStart(2, '0')}:00</span>}</div>
        ))}
        {blocks.map(({ i, left, width, lane }) => (
          <Link key={i.stepId} to={`/tickets/${i.ticketId}`} title={`${i.ticketNo} · ${i.step}\n${fmtClock(i.startedAt)} → ${i.completedAt ? fmtClock(i.completedAt) : 'running'}\nest ${i.estimatedMinutes}m · actual ${i.actualMinutes}m`}
            className={clsx('absolute h-5 overflow-hidden rounded px-1 text-[10px] leading-5 text-bg', i.status === 'IN_PROGRESS' ? 'animate-pulse bg-brand' : i.overrun ? 'hatch bg-danger text-white' : 'bg-ok')}
            style={{ left: `${left}%`, width: `${width}%`, top: lane * 26 }}>{width > 6 ? i.ticketNo : ''}</Link>
        ))}
        {items.length === 0 && <p className="absolute inset-0 grid place-items-center text-xs text-mute">No work recorded</p>}
      </div>
    </div>
  );
}

export function DayReport({ technicianId, date }: { technicianId: string; date: string }) {
  const [rep, setRep] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scale = useUi((s) => s.timeScale);
  const isToday = date === toLocalDateInput(new Date());
  // today's report refreshes when this technician's steps change (pushed over WebSocket), no timer
  const stepsSig = useData((s) => (isToday ? Object.values(s.steps).flat().filter((x) => x.assigneeId === technicianId).map((x) => x.id + x.status).join('|') : ''));

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const { from, to } = dayRange(date);
      get<Report>(`/reports/technicians/${technicianId}/day?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        .then((r) => { if (live) { setRep(r); setError(null); } })
        .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load the report'));
    }, rep ? 500 : 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicianId, date, stepsSig]);

  const csv = () => {
    if (!rep) return;
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Date', 'Technician', 'Ticket', 'Step', 'Customer', 'Started', 'Finished', 'Estimated min', 'Actual min', 'Over min', 'Status', 'Note'],
      ...rep.items.map((i) => [date, rep.technician.name, i.ticketNo, i.step, i.customer, fmtClock(i.startedAt), fmtClock(i.completedAt), i.estimatedMinutes, i.actualMinutes, i.overrunMinutes, i.status, i.note ?? ''])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${rep.technician.name.replace(/\s+/g, '-')}-${date}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const s = rep?.summary;
  const rows = useMemo(() => rep?.items ?? [], [rep]);
  if (error) return <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>;
  if (!rep || !s) return <div className="space-y-3"><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-20" />)}</div><div className="skeleton h-32" /></div>;

  return (
    <div className="space-y-4" data-testid="day-report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5"><Avatar name={rep.technician.name} size={36} /><div><p className="font-semibold">{rep.technician.name}</p><p className="text-xs text-mute">{rep.technician.email} · {new Date(date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div></div>
        <div className="no-print flex gap-2"><button className="btn-ghost" onClick={csv}><Download className="h-4 w-4" />CSV</button><button className="btn-ghost" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button></div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Steps completed" value={s.stepsCompleted} tone="text-ok" sub={s.stepsInProgress ? `${s.stepsInProgress} running now` : 'none running'} />
        <Tile label="Work time" value={fmtMinutes(s.actualMinutes)} sub={`estimated ${fmtMinutes(s.estimatedMinutes)}${s.accuracyPct !== null ? ` · ${s.accuracyPct}%` : ''}`} tone={s.accuracyPct !== null && s.accuracyPct > 115 ? 'text-warn' : 'text-ink'} />
        <Tile label="Overruns" value={s.overrunSteps} tone={s.overrunSteps ? 'text-warn' : 'text-ok'} sub={s.overrunSteps ? `+${fmtMinutes(s.overrunMinutes)} over estimate` : 'all within estimate'} />
        <Tile label="Tickets" value={s.ticketsWorked} sub={`${s.ticketsResolved} resolved · ${s.ticketsAssigned} assigned`} />
        <Tile label="Active / idle" value={`${fmtMinutes(s.activeMinutes)}`} sub={`idle gaps ${fmtMinutes(s.idleMinutes)}`} />
        <Tile label="First → last" value={<span className="text-lg">{fmtClock(s.firstActivity).slice(0, 5)}–{fmtClock(s.lastActivity).slice(0, 5)}</span>} sub="clock time of activity" />
      </div>

      <DayTimeline items={rows} date={date} />

      <div className="card overflow-hidden">
        <h3 className="border-b border-line p-3 text-sm font-semibold">Everything done this day ({rows.length})</h3>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="p-3">Time</th><th>Ticket</th><th>Step</th><th>Customer</th><th className="text-right">Estimated</th><th className="text-right">Actual</th><th className="text-right">Diff</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.stepId} className="border-b border-line/60">
                  <td className="mono p-3 text-xs">{fmtClock(i.startedAt).slice(0, 5)} → {i.completedAt ? fmtClock(i.completedAt).slice(0, 5) : <span className="text-brand">running</span>}</td>
                  <td><Link to={`/tickets/${i.ticketId}`} className="mono text-xs font-bold text-brand hover:underline">{i.ticketNo}</Link></td>
                  <td className="font-medium">{i.step}</td>
                  <td className="text-xs text-mute">{i.customer}{i.area ? ` · ${i.area}` : ''}</td>
                  <td className="mono text-right">{i.estimatedMinutes}m</td>
                  <td className="mono text-right font-semibold">{i.actualMinutes}m</td>
                  <td className={clsx('mono text-right text-xs', i.overrun ? 'font-semibold text-warn' : 'text-ok')}>{i.overrun ? `+${i.overrunMinutes}m` : 'on time'}</td>
                  <td><span className={clsx('chip', i.status === 'DONE' ? 'border-ok/40 text-ok' : 'border-brand/40 text-brand')}>{i.status === 'DONE' ? 'Done' : 'Working'}</span></td>
                  <td className="max-w-[220px] truncate text-xs text-mute" title={i.note ?? ''}>{i.note?.split('Note: ')[1] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-line/60 md:hidden">
          {rows.map((i) => <li key={i.stepId} className="space-y-0.5 p-3 text-sm"><p><span className="mono text-xs font-bold text-brand">{i.ticketNo}</span> {i.step}</p><p className="mono text-xs text-mute">{fmtClock(i.startedAt).slice(0, 5)} → {i.completedAt ? fmtClock(i.completedAt).slice(0, 5) : 'running'} · est {i.estimatedMinutes}m · actual {i.actualMinutes}m {i.overrun && <b className="text-warn">(+{i.overrunMinutes}m)</b>}</p></li>)}
        </ul>
        {rows.length === 0 && <p className="p-10 text-center text-sm text-mute">No work recorded on this day.</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4"><h3 className="mb-2 text-sm font-semibold">Tickets resolved ({rep.resolvedTickets.length})</h3><ul className="space-y-1.5 text-sm">{rep.resolvedTickets.map((t) => <li key={t.id} className="flex justify-between gap-2"><Link to={`/tickets/${t.id}`} className="truncate hover:text-brand"><span className="mono text-xs font-bold text-brand">{t.ticketNo}</span> {t.title}</Link><span className="mono shrink-0 text-xs text-mute">{fmtClock(t.at).slice(0, 5)}</span></li>)}{rep.resolvedTickets.length === 0 && <li className="text-xs text-mute">None</li>}</ul></div>
        <div className="card p-4"><h3 className="mb-2 text-sm font-semibold">Tickets assigned ({rep.assignedTickets.length})</h3><ul className="space-y-1.5 text-sm">{rep.assignedTickets.map((t, k) => <li key={k} className="flex justify-between gap-2"><span className="truncate"><span className="mono text-xs font-bold text-brand">{t.ticketNo}</span> {t.title}</span><span className="mono shrink-0 text-xs text-mute">{fmtClock(t.at).slice(0, 5)}</span></li>)}{rep.assignedTickets.length === 0 && <li className="text-xs text-mute">None</li>}</ul></div>
      </div>
      {scale > 1 && <p className="text-[11px] text-mute">Durations are work minutes on the demo clock ×{scale}; clock times are real.</p>}
    </div>
  );
}
