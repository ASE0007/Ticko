import { Download, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ApiError, get, post } from '../api/client';
import type { ReportSummary } from '../api/types';
import { useAuth } from '../store/auth';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { STATUS_META, fmtMinutes } from '../lib/format';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { ProgressRing } from '../components/Rings';

const COLORS = ['#22d3ee', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#94a3b8'];

export default function Reports() {
  const [s, setS] = useState<ReportSummary | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useData((st) => (exportId ? st.jobs[exportId] : undefined));
  const sig = useData((st) => Object.values(st.tickets).map((t) => t.status).join(''));

  useEffect(() => { const t = setTimeout(() => { get<ReportSummary>('/reports/summary').then(setS).catch((e) => setError(e.message)); }, 400); return () => clearTimeout(t); }, [sig]);

  // the CSV is built in a worker thread; we download when the "job.completed" event arrives (no polling)
  useEffect(() => {
    if (!exportId || job?.status !== 'SUCCEEDED') return;
    (async () => {
      try {
        const res = await fetch(`/api/reports/export/${exportId}`, { headers: { authorization: `Bearer ${useAuth.getState().token}` } });
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'ticko-report.csv'; a.click();
        URL.revokeObjectURL(a.href);
        useUi.getState().toast({ kind: 'ok', title: 'Report downloaded' });
      } finally { setExportId(null); }
    })();
  }, [job?.status, exportId]);

  const startExport = async () => {
    try { const r = await post<{ jobId: string }>('/reports/export', {}); useData.getState().upsertJob({ jobId: r.jobId, ticketId: null, type: 'EXPORT_REPORT', status: 'QUEUED', progress: 0, stage: 'Queued' }); setExportId(r.jobId); }
    catch (e) { useUi.getState().toast({ kind: 'danger', title: e instanceof ApiError ? e.message : 'Export failed' }); }
  };

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!s) return <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div>;

  const cat = Object.entries(s.byCategory).map(([k, v]) => ({ name: k, value: v })); // server already returns category names
  const status = Object.entries(s.byStatus).map(([k, v]) => ({ name: STATUS_META[k as keyof typeof STATUS_META]?.label ?? k, value: v }));
  const acc = s.estimateAccuracy;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-bold">Reports</h1><p className="text-sm text-mute">Service quality, SLA compliance and how realistic our estimates are.</p></div>
        <button className="btn-primary" onClick={startExport} disabled={!!exportId}>{exportId ? <><Loader2 className="h-4 w-4 animate-spin" />{job?.stage ?? 'Preparing'} {job?.progress ?? 0}%</> : <><Download className="h-4 w-4" />Export CSV</>}</button></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/tickets" className="card block p-4 transition hover:border-brand/60" aria-label="Open all tickets"><p className="label">Tickets</p><p className="text-3xl font-bold mono"><AnimatedNumber value={s.total} /></p><p className="text-xs text-mute">{s.resolved} resolved</p></Link>
        <div className="card flex items-center justify-between p-4"><div><p className="label">SLA compliance</p><p className="text-3xl font-bold mono text-ok"><AnimatedNumber value={s.slaCompliancePct} suffix="%" /></p></div><ProgressRing value={s.slaCompliancePct} color="rgb(var(--ok))" size={52} /></div>
        <div className="card p-4"><p className="label">Avg resolution</p><p className="text-3xl font-bold mono">{fmtMinutes(s.avgResolutionMin)}</p><p className="text-xs text-mute">report → verified fix</p></div>
        <Link to="/tickets?status=REOPENED" className="card block p-4 transition hover:border-brand/60" aria-label="Open reopened tickets"><p className="label">Reopen rate</p><p className="text-3xl font-bold mono text-warn"><AnimatedNumber value={s.reopenRatePct} suffix="%" /></p><p className="text-xs text-mute">customer said “still broken”</p></Link>
      </div>
      <div className="card p-4">
        <h2 className="mb-1 font-semibold">Estimate accuracy</h2>
        <p className="text-sm text-mute">Across {acc.stepsMeasured} finished steps: estimated <b className="mono text-ink">{fmtMinutes(acc.estimatedMin)}</b>, actual <b className={`mono ${acc.ratio > 1.15 ? 'text-warn' : 'text-ok'}`}>{fmtMinutes(acc.actualMin)}</b> ({Math.round(acc.ratio * 100)}% of estimate).</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${acc.ratio > 1.15 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${Math.min(100, acc.ratio * 50)}%` }} /></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4"><h2 className="mb-2 font-semibold">By category</h2><div className="h-56"><ResponsiveContainer><BarChart data={cat}><CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgb(var(--mute))' }} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'rgb(var(--mute))' }} /><Tooltip contentStyle={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))', borderRadius: 8 }} /><Bar dataKey="value" fill="#22d3ee" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
        <div className="card p-4"><h2 className="mb-2 font-semibold">By status</h2><div className="h-56"><ResponsiveContainer><PieChart><Pie data={status} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>{status.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length] as string} />)}</Pie><Tooltip contentStyle={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))', borderRadius: 8 }} /></PieChart></ResponsiveContainer></div></div>
        <div className="card p-4"><h2 className="mb-2 font-semibold">Technician leaderboard</h2><ul className="space-y-2">{s.technicians.map((t) => <li key={t.name} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2 text-sm"><span>{t.name}</span><span className="mono text-xs text-mute">{t.resolved} resolved · avg {fmtMinutes(t.avgResolutionMin)}</span></li>)}{s.technicians.length === 0 && <li className="text-sm text-mute">No resolved tickets yet.</li>}</ul></div>
      </div>
    </div>
  );
}
