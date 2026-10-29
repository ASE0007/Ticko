import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ApiError, get } from '../api/client';
import type { TeamDayRow } from '../api/types';
import { DateNav, DayReport } from '../components/DayReport';
import { Avatar } from '../components/Badges';
import { dayRange, fmtClock, fmtMinutes, toLocalDateInput } from '../lib/format';
import { useData } from '../store/data';

/** Supervisor / admin: one line per technician for a day; click a technician for the full itemised report. */
export default function TeamReport() {
  const [date, setDate] = useState(toLocalDateInput(new Date()));
  const [rows, setRows] = useState<TeamDayRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepsSig = useData((s) => Object.values(s.steps).flat().map((x) => x.status).join(''));

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const { from, to } = dayRange(date);
      get<{ rows: TeamDayRow[] }>(`/reports/technicians/day?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        .then((r) => { if (live) { setRows(r.rows); setError(null); setSelected((cur) => cur ?? r.rows.find((x) => x.stepsCompleted + x.stepsInProgress > 0)?.technicianId ?? r.rows[0]?.technicianId ?? null); } })
        .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load'));
    }, rows ? 500 : 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, stepsSig]);

  const csv = () => {
    if (!rows) return;
    const head = ['Date', 'Technician', 'Steps completed', 'Work min', 'Estimated min', 'Accuracy %', 'Overrun steps', 'Overrun min', 'Tickets worked', 'Tickets resolved', 'First activity', 'Last activity'];
    const body = rows.map((r) => [date, r.name, r.stepsCompleted, r.actualMinutes, r.estimatedMinutes, r.accuracyPct ?? '', r.overrunSteps, r.overrunMinutes, r.ticketsWorked, r.ticketsResolved, fmtClock(r.firstActivity), fmtClock(r.lastActivity)]);
    const blob = new Blob([[head, ...body].map((r) => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `team-day-${date}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold">Technician day reports</h1><p className="text-sm text-mute">Exactly what each technician did, when, and how it compared with the estimate.</p></div>
        <div className="flex items-center gap-2"><DateNav date={date} onChange={setDate} /><button className="btn-ghost no-print" onClick={csv}><Download className="h-4 w-4" />Team CSV</button></div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="p-3">Technician</th><th className="text-right">Steps done</th><th className="text-right">Work time</th><th className="text-right">Estimated</th><th className="text-right">Accuracy</th><th className="text-right">Overruns</th><th className="text-right">Tickets resolved</th><th>Active</th></tr></thead>
          <tbody>
            {!rows && Array.from({ length: 4 }, (_, i) => <tr key={i}><td colSpan={8} className="p-2"><div className="skeleton h-9" /></td></tr>)}
            {rows?.map((r) => (
              <tr key={r.technicianId} onClick={() => setSelected(r.technicianId)} className={clsx('cursor-pointer border-b border-line/60 transition hover:bg-panel2/60', selected === r.technicianId && 'bg-brand/10')} aria-selected={selected === r.technicianId}>
                <td className="p-3"><span className="flex items-center gap-2"><Avatar name={r.name} size={26} /><span className="font-medium">{r.name}</span></span></td>
                <td className="mono text-right font-semibold">{r.stepsCompleted}{r.stepsInProgress > 0 && <span className="ml-1 text-[10px] text-brand">+{r.stepsInProgress} running</span>}</td>
                <td className="mono text-right">{fmtMinutes(r.actualMinutes)}</td>
                <td className="mono text-right text-mute">{fmtMinutes(r.estimatedMinutes)}</td>
                <td className={clsx('mono text-right', r.accuracyPct !== null && r.accuracyPct > 115 ? 'text-warn' : 'text-ok')}>{r.accuracyPct !== null ? `${r.accuracyPct}%` : '—'}</td>
                <td className={clsx('mono text-right', r.overrunSteps ? 'text-warn' : 'text-mute')}>{r.overrunSteps}</td>
                <td className="mono text-right">{r.ticketsResolved}</td>
                <td className="mono text-xs text-mute">{r.firstActivity ? `${fmtClock(r.firstActivity).slice(0, 5)}–${fmtClock(r.lastActivity).slice(0, 5)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <DayReport technicianId={selected} date={date} />}
    </div>
  );
}
