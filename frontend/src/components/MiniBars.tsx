import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { get } from '../api/client';
import { useData } from '../store/data';

interface Bucket { hour: string; created: number; resolved: number }

/** Lightweight SVG chart (no chart library): tickets filed vs. resolved per hour. */
export function ThroughputChart({ hours = 12 }: { hours?: number }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const created = useData((s) => s.metrics?.tickets.createdLast24h ?? 0);
  const resolved = useData((s) => s.metrics?.tickets.resolvedLast24h ?? 0);

  // refetch only when the counters change (they arrive over WebSocket): no timers
  useEffect(() => {
    const t = setTimeout(() => { get<{ buckets: Bucket[] }>(`/reports/throughput?hours=${hours}`).then((r) => setBuckets(r.buckets)).catch(() => undefined); }, 300);
    return () => clearTimeout(t);
  }, [hours, created, resolved]);

  const max = Math.max(3, ...buckets.map((b) => Math.max(b.created, b.resolved)));
  const W = 360, H = 120, pad = 18, bw = (W - pad * 2) / Math.max(1, buckets.length);
  return (
    <section className="card p-4" aria-label="Throughput">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-brand" />Last {hours} hours</h2>
        <div className="flex gap-3 text-[11px] text-mute"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-info" />filed {created}/24h</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ok" />resolved {resolved}/24h</span></div>
      </header>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label="Tickets filed and resolved per hour">
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={pad} x2={W - pad} y1={H - g * (H - 8)} y2={H - g * (H - 8)} stroke="rgb(var(--line))" strokeDasharray="3 4" />)}
        {buckets.map((b, i) => {
          const x = pad + i * bw;
          const h1 = (b.created / max) * (H - 8);
          const h2 = (b.resolved / max) * (H - 8);
          return (
            <g key={b.hour}>
              <motion.rect x={x + bw * 0.12} width={bw * 0.36} rx={2} fill="rgb(var(--info))" initial={false} animate={{ y: H - h1, height: h1 }} transition={{ type: 'spring', stiffness: 120, damping: 18 }}><title>{`${new Date(b.hour).getHours()}:00 filed ${b.created}`}</title></motion.rect>
              <motion.rect x={x + bw * 0.52} width={bw * 0.36} rx={2} fill="rgb(var(--ok))" initial={false} animate={{ y: H - h2, height: h2 }} transition={{ type: 'spring', stiffness: 120, damping: 18 }}><title>{`${new Date(b.hour).getHours()}:00 resolved ${b.resolved}`}</title></motion.rect>
              {i % 2 === 0 && <text x={x + bw / 2} y={H + 12} textAnchor="middle" fontSize="8" fill="rgb(var(--mute))">{new Date(b.hour).getHours()}h</text>}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
