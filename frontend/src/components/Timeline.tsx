import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRightLeft, Cog, ListChecks, UserCheck } from 'lucide-react';
import type { TimelineItem } from '../api/types';
import { timeAgo } from '../lib/format';
import { humanizeTimeline } from '../lib/timeline';
import { useNow } from '../hooks/useNow';

const ICON: Record<string, typeof Cog> = { TICKET: ArrowRightLeft, STEP: ListChecks, ASSIGNMENT: UserCheck, JOB: Cog, SYSTEM: AlertTriangle };

export function Timeline({ items }: { items: TimelineItem[] }) {
  const now = useNow(10_000);
  return (
    <ol className="relative space-y-3 border-l border-line pl-5" data-testid="timeline">
      {[...items].reverse().map((it, i) => {
        const Icon = ICON[it.entity] ?? Cog;
        const warn = it.entity === 'SYSTEM';
        return (
          <motion.li key={it.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }} className="relative">
            <span className={`absolute -left-[31px] top-0.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-panel ${warn ? 'text-warn' : 'text-brand'}`}><Icon className="h-3 w-3" /></span>
            <p className="text-sm">{humanizeTimeline(it)}</p>
            <p className="text-[11px] text-mute">{it.actor} · {timeAgo(it.createdAt, now)} · {new Date(it.createdAt).toLocaleTimeString()}</p>
          </motion.li>
        );
      })}
    </ol>
  );
}
