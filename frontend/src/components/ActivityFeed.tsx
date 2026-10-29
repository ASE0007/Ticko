import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useData } from '../store/data';
import { timeAgo } from '../lib/format';
import { useNow } from '../hooks/useNow';

const DOT = { info: 'bg-info', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' };

export function ActivityFeed({ limit = 12 }: { limit?: number }) {
  const items = useData((s) => s.activity).slice(0, limit);
  const now = useNow(5000);
  return (
    <div className="card p-3" data-testid="activity">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">Live activity</h3>
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {items.map((a) => (
            <motion.li key={a.id} layout initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-2 text-xs">
              <span className={clsx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', DOT[a.kind])} />
              <span className="min-w-0 flex-1">
                {a.ticketId ? <Link to={`/tickets/${a.ticketId}`} className="hover:underline">{a.text}</Link> : a.text}
                <span className="ml-1.5 text-mute">{timeAgo(a.ts, now)}</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
        {items.length === 0 && <li className="py-3 text-center text-xs text-mute">Waiting for events… create a ticket to see it live.</li>}
      </ul>
    </div>
  );
}
