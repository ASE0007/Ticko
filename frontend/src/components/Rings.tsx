import { motion } from 'framer-motion';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { SlaState } from '../api/types';
import { SLA_META, fmtMinutes } from '../lib/format';
import { useNow } from '../hooks/useNow';
import { useUi } from '../store/ui';

export function ProgressRing({ value, size = 44, stroke = 5, color = 'rgb(var(--brand))', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--line))" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - v / 100) }}
          transition={{ type: 'spring', stiffness: 70, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[10px] font-semibold mono">{children ?? `${Math.round(v)}%`}</div>
    </div>
  );
}

/** Live SLA countdown: arc = share of the SLA window still left; colour morphs with the SLA state. */
export function SlaRing({ state, startedAt, deadline, size = 44, closed = false }: { state: SlaState; startedAt: string; deadline: string; size?: number; closed?: boolean }) {
  const now = useNow(1000);
  const scale = useUi((s) => s.timeScale);
  const start = new Date(startedAt).getTime();
  const end = new Date(deadline).getTime();
  const total = Math.max(1, end - start);
  const left = end - now;
  const frac = closed ? (state === 'BREACHED' ? 0 : 1) : Math.max(0, Math.min(1, left / total));
  const color = SLA_META[state].color;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const label = closed ? (state === 'BREACHED' ? 'late' : 'met') : left <= 0 ? `+${fmtMinutes((-left * scale) / 60_000)}` : fmtMinutes((left * scale) / 60_000);
  const hot = !closed && (state === 'WARNING' || state === 'AT_RISK');
  return (
    <div className={clsx('relative shrink-0', state === 'BREACHED' && !closed && 'animate-shake')} style={{ width: size, height: size }} title={`SLA ${SLA_META[state].label}`} role="img" aria-label={`SLA ${SLA_META[state].label}, ${label} ${left <= 0 ? 'over' : 'left'}`}>
      {hot && <span className="absolute inset-0 rounded-full animate-pulseRing" style={{ border: `2px solid ${color}` }} />}
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--line))" strokeWidth={4} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round" strokeDasharray={c}
          initial={false} animate={{ strokeDashoffset: c * (1 - frac), stroke: color }} transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[9px] font-semibold leading-none mono" style={{ color }}>{label}</div>
    </div>
  );
}
