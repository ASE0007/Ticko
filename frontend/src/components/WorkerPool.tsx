import { motion } from 'framer-motion';
import { Cpu } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useData } from '../store/data';
import { isManager, useAuth } from '../store/auth';
import { ProgressRing } from './Rings';

const LABEL: Record<string, string> = { DIAGNOSE_LINE: 'Line diagnostics', VERIFY_SPEED: 'Speed verification', EXPORT_REPORT: 'Report export' };

/** Live view of the backend worker pool: N slots, running jobs with progress, queue depth. */
export function WorkerPool() {
  const metrics = useData((s) => s.metrics);
  const jobs = useData((s) => s.jobs);
  const tickets = useData((s) => s.tickets);
  const manager = isManager(useAuth((st) => st.user));
  const running = Object.values(jobs).filter((j) => j.status === 'RUNNING');
  const queued = Object.values(jobs).filter((j) => j.status === 'QUEUED');
  const slots = metrics?.queue.concurrency ?? 3;
  return (
    <div className="card p-3" data-testid="worker-pool">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-mute"><Cpu className="h-3.5 w-3.5" />{manager ? <Link to="/jobs" className="hover:text-brand hover:underline">Worker pool →</Link> : 'Worker pool'}</h3>
        <span className="chip border-line mono text-mute">{running.length}/{slots} busy · {queued.length} queued</span>
      </div>
      <ul className="space-y-1.5">
        {Array.from({ length: slots }, (_, i) => {
          const j = running[i];
          const t = j?.ticketId ? tickets[j.ticketId] : undefined;
          return (
            <li key={i} className={clsx('flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5', j ? 'border-info/40 bg-info/5' : 'border-dashed border-line')}>
              {j ? <ProgressRing value={j.progress} size={32} stroke={4} color="rgb(var(--info))" /> : <span className="grid h-8 w-8 place-items-center text-[10px] text-mute">idle</span>}
              <div className="min-w-0 text-xs">
                {j ? (
                  <>
                    <p className="truncate font-medium">{LABEL[j.type] ?? j.type}{t && <span className="mono text-brand"> · {t.ticketNo}</span>}</p>
                    <motion.p key={j.stage} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="truncate text-mute">{j.stage}</motion.p>
                  </>
                ) : <p className="text-mute">Worker {i + 1} waiting for work</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {metrics && <p className="mt-2 text-[11px] text-mute">{metrics.queue.jobsPerMin} jobs/min · {metrics.queue.succeeded} done · {metrics.queue.failed} failed</p>}
    </div>
  );
}
