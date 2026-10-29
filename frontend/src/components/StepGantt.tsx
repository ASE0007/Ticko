import { motion } from 'framer-motion';
import { CheckCircle2, Lock, PlayCircle, SkipForward } from 'lucide-react';
import clsx from 'clsx';
import type { Step } from '../api/types';
import { fmtMinutes, simMinutes } from '../lib/format';
import { useNow } from '../hooks/useNow';
import { useUi } from '../store/ui';
import { StepBadge } from './Badges';

/**
 * Estimated (ghost outline) vs actual (solid) per step. Time beyond the estimate is drawn hatched
 * in red, so overruns are never hidden (BR-07). Locked steps show what they are waiting for.
 */
export function StepGantt({ steps, actions }: { steps: Step[]; actions?: (s: Step) => React.ReactNode }) {
  const now = useNow(500);
  const scale = useUi((s) => s.timeScale);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const live = (s: Step) => (s.status === 'IN_PROGRESS' && s.startedAt ? simMinutes(s.startedAt, now, scale) : s.status === 'DONE' ? s.actualMinutes ?? 0 : 0);
  const longest = Math.max(10, ...steps.map((s) => Math.max(s.estimatedMinutes, live(s), s.status === 'IN_PROGRESS' ? live(s) + s.etaMinutes : 0)));
  const max = longest * 1.08;

  return (
    <ol className="space-y-2.5" data-testid="gantt">
      {steps.map((s) => {
        const actual = live(s);
        const withinEst = Math.min(actual, s.estimatedMinutes);
        const over = Math.max(0, actual - s.estimatedMinutes);
        const waitingFor = s.dependsOn.map((d) => byId.get(d)).filter((d) => d && d.status !== 'DONE' && d.status !== 'SKIPPED');
        return (
          <li key={s.id} className={clsx('rounded-lg border border-line bg-panel2/60 p-2.5', s.status === 'IN_PROGRESS' && 'border-brand/50')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {s.status === 'DONE' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" /> : s.status === 'LOCKED' ? <Lock className="h-4 w-4 shrink-0 text-mute" /> : s.status === 'SKIPPED' ? <SkipForward className="h-4 w-4 shrink-0 text-mute" /> : <PlayCircle className={clsx('h-4 w-4 shrink-0', s.status === 'IN_PROGRESS' ? 'animate-pulse text-brand' : 'text-info')} />}
                <span className="mono text-xs text-mute">#{s.seq}</span>
                <span className="truncate text-sm font-medium">{s.title}</span>
                <StepBadge status={s.status} />
                {s.overrun && s.status === 'IN_PROGRESS' && <span className="chip animate-pulse border-warn/50 bg-warn/10 text-warn">⏱ OVERRUN {s.overrunLevel === 3 ? '2×' : s.overrunLevel === 2 ? '1.5×' : '1×'}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="mono text-[11px] text-mute">est {fmtMinutes(s.estimatedMinutes)}{s.status !== 'LOCKED' && s.status !== 'READY' && <> · <span className={over > 0 ? 'font-semibold text-warn' : 'text-ok'}>act {fmtMinutes(actual)}</span></>}</span>
                {actions?.(s)}
              </div>
            </div>
            <div className="relative mt-2 h-3.5 rounded bg-line/50" aria-hidden>
              <div className="absolute inset-y-0 left-0 rounded border border-dashed border-mute/60" style={{ width: `${(s.estimatedMinutes / max) * 100}%` }} />
              <motion.div className="absolute inset-y-0 left-0 rounded-l bg-ok/80" initial={false} animate={{ width: `${(withinEst / max) * 100}%` }} transition={{ ease: 'linear', duration: 0.5 }} />
              <motion.div className="hatch absolute inset-y-0 rounded-r bg-danger" initial={false} animate={{ left: `${(s.estimatedMinutes / max) * 100}%`, width: `${(over / max) * 100}%` }} transition={{ ease: 'linear', duration: 0.5 }} />
            </div>
            {(waitingFor.length > 0 || s.assigneeName) && (
              <p className="mt-1.5 text-[11px] text-mute">
                {waitingFor.length > 0 && <>🔒 Waiting for step {waitingFor.map((w) => `#${w!.seq}`).join(' and ')} to finish. It does not start just because time has passed.</>}
                {waitingFor.length > 0 && s.assigneeName && ' · '}
                {s.assigneeName && <>👤 {s.assigneeName}</>}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
