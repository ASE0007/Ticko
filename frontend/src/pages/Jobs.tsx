import { Ban, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ApiError, get, post } from '../api/client';
import type { Job } from '../api/types';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { WorkerPool } from '../components/WorkerPool';
import { timeAgo } from '../lib/format';
import { useNow } from '../hooks/useNow';

const TONE: Record<string, string> = { QUEUED: 'text-mute', RUNNING: 'text-info', SUCCEEDED: 'text-ok', FAILED: 'text-danger', CANCELLED: 'text-mute' };
const LABEL: Record<string, string> = { DIAGNOSE_LINE: 'Line diagnostics', VERIFY_SPEED: 'Speed verification', EXPORT_REPORT: 'Report export' };

export default function Jobs() {
  const [rows, setRows] = useState<Job[]>([]);
  const [only, setOnly] = useState<string | null>(null);
  const live = useData((s) => s.jobs);
  const metrics = useData((s) => s.metrics);
  const now = useNow(10_000);
  const sig = Object.values(live).map((j) => `${j.jobId}${j.status}`).join('|');

  // list is re-read when a job changes state (events), not on a timer
  useEffect(() => {
    const t = setTimeout(() => { get<{ items: Job[] }>('/jobs?limit=40').then((r) => setRows(r.items)).catch(() => undefined); }, 250);
    return () => clearTimeout(t);
  }, [sig]);

  const act = async (id: string, what: 'cancel' | 'retry') => {
    try { await post(`/jobs/${id}/${what}`); } catch (e) { useUi.getState().toast({ kind: 'warn', title: e instanceof ApiError ? e.message : 'Failed' }); }
  };

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Background jobs</h1><p className="text-sm text-mute">Diagnostics and speed verification run in a priority queue on a pool of workers. API calls never wait for them.</p></div>
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          <WorkerPool />
          {metrics && (
            <div className="card grid grid-cols-2 gap-2 p-3 text-center text-xs">
              {([['Queued', metrics.queue.queued, 'QUEUED'], ['Running', metrics.queue.running, 'RUNNING'], ['Succeeded', metrics.queue.succeeded, 'SUCCEEDED'], ['Retried', metrics.queue.retried, null], ['Failed', metrics.queue.failed, 'FAILED'], ['Cancelled', metrics.queue.cancelled, 'CANCELLED']] as const).map(([k, v, st]) => (
                st ? (
                  <button key={k} type="button" aria-pressed={only === st} onClick={() => setOnly(only === st ? null : st)} title={only === st ? 'Show all jobs' : `Show only ${k.toLowerCase()} jobs`}
                    className={clsx('rounded-lg border p-2 transition hover:border-brand/60', only === st ? 'border-brand bg-brand/10' : 'border-transparent bg-panel2')}><p className="mono text-xl font-bold">{v}</p><p className="text-mute">{k}</p></button>
                ) : <div key={k} className="rounded-lg bg-panel2 p-2"><p className="mono text-xl font-bold">{v}</p><p className="text-mute">{k}</p></div>
              ))}
            </div>
          )}
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="p-3">Job</th><th>Ticket</th><th>Status</th><th className="w-36">Progress</th><th>When</th><th /></tr></thead>
            <tbody>
              {rows.filter((j) => !only || (live[j.id]?.status ?? j.status) === only).map((j) => {
                const l = live[j.id];
                const status = l?.status ?? j.status;
                const progress = l?.progress ?? j.progress;
                return (
                  <tr key={j.id} className="border-b border-line/60">
                    <td className="p-3 font-medium">{LABEL[j.type] ?? j.type}<br /><span className="text-[11px] text-mute">{l?.stage ?? j.stage ?? ''}{j.attempts > 1 && ` · attempt ${j.attempts}/${j.maxAttempts}`}</span></td>
                    <td className="mono text-xs text-brand">{j.ticketNo ?? '—'}</td>
                    <td className={clsx('text-xs font-semibold', TONE[status])}>{status}</td>
                    <td><div className="h-1.5 overflow-hidden rounded-full bg-line"><div className={clsx('h-full rounded-full transition-all duration-500', status === 'FAILED' ? 'bg-danger' : 'bg-info')} style={{ width: `${progress}%` }} /></div></td>
                    <td className="text-xs text-mute">{timeAgo(j.createdAt, now)}</td>
                    <td className="pr-3 text-right">
                      {(status === 'QUEUED' || status === 'RUNNING') && <button className="btn-ghost !p-1.5" title="Cancel job" aria-label="Cancel job" onClick={() => act(j.id, 'cancel')}><Ban className="h-3.5 w-3.5" /></button>}
                      {(status === 'FAILED' || status === 'CANCELLED') && <button className="btn-ghost !p-1.5" title="Retry job" aria-label="Retry job" onClick={() => act(j.id, 'retry')}><RotateCw className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-sm text-mute">No jobs yet.</td></tr>}
              {rows.length > 0 && only && !rows.some((j) => (live[j.id]?.status ?? j.status) === only) && <tr><td colSpan={6} className="p-8 text-center text-sm text-mute">No {only.toLowerCase()} jobs. <button className="text-brand underline" onClick={() => setOnly(null)}>Show all</button></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
