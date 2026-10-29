import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get } from '../api/client';
import type { Page, Priority, SlaState, Ticket, TicketStatus } from '../api/types';
import { useData } from '../store/data';
import { Avatar, PriorityBadge, SlaBadge, StatusBadge } from '../components/Badges';
import { ALL_PRIORITIES, ALL_STATUSES, OPEN_STATUSES, PRIORITY_META, STATUS_META, timeAgo } from '../lib/format';
import { useNow } from '../hooks/useNow';

const SLA_STATES: SlaState[] = ['ON_TRACK', 'AT_RISK', 'WARNING', 'BREACHED'];

function Chips<T extends string>({ all, value, onChange, label }: { all: T[]; value: T[]; onChange: (v: T[]) => void; label: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" aria-pressed={value.length === 0} onClick={() => onChange([])} className={clsx('chip transition', value.length === 0 ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mute hover:text-ink')}>All</button>
      {all.map((v) => {
        const on = value.includes(v);
        return <button key={v} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])} className={clsx('chip transition', on ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mute hover:text-ink')}>{label(v)}</button>;
      })}
    </div>
  );
}

const DONE_STATUSES: TicketStatus[] = ['CLOSED', 'CANCELLED'];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const fromUrl = <T extends string>(raw: string | null, allowed: readonly T[]): T[] => (raw ?? '').split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));

/** Dashboard cards link here with filters in the address (e.g. /tickets?status=AWAITING_ASSIGNMENT). */
export default function Tickets() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [dq, setDq] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState<TicketStatus[]>(() => fromUrl(params.get('status'), ALL_STATUSES));
  const [priority, setPriority] = useState<Priority[]>(() => fromUrl(params.get('priority'), ALL_PRIORITIES));
  const [sla, setSla] = useState<SlaState[]>(() => fromUrl(params.get('sla'), SLA_STATES));
  const [category, setCategory] = useState<string[]>(() => (params.get('category') ?? '').split(',').filter(Boolean));
  const categories = useData((s) => s.categories);
  const [unassigned, setUnassigned] = useState(params.get('unassigned') === 'true');
  const [limit, setLimit] = useState(15);
  const [techId, setTechId] = useState(params.get('technicianId') ?? '');
  const technicians = useData((s) => s.technicians);
  const [sort, setSort] = useState(['createdAt', 'number', 'priority', 'slaDeadline', 'updatedAt'].includes(params.get('sort') ?? '') ? (params.get('sort') as string) : 'createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Page<Ticket> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedAt = useRef(new Date().toISOString());
  const store = useData((s) => s.tickets);
  const now = useNow(15_000);

  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [status, priority, sla, category, unassigned, techId, sort, order, limit]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const p = new URLSearchParams({ page: String(page), limit: String(limit), sort, order });
    if (dq) p.set('q', dq);
    if (status.length) p.set('status', status.join(','));
    if (priority.length) p.set('priority', priority.join(','));
    if (sla.length) p.set('slaState', sla.join(','));
    if (category.length) p.set('category', category.join(','));
    if (unassigned) p.set('unassigned', 'true');
    if (techId) p.set('technicianId', techId);
    try {
      const r = await get<Page<Ticket>>(`/tickets?${p}`);
      setRes(r); loadedAt.current = new Date().toISOString();
      useData.getState().setTickets(r.items);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); } finally { setLoading(false); }
  }, [page, limit, dq, status, priority, sla, category, unassigned, techId, sort, order]);
  useEffect(() => { void load(); }, [load]);

  // rows always show the freshest copy pushed over WebSocket
  const rows = useMemo(() => (res?.items ?? []).map((t) => store[t.id] ?? t), [res, store]);
  const ids = useMemo(() => new Set(res?.items.map((t) => t.id)), [res]);
  const fresh = Object.values(store).filter((t) => t.createdAt > loadedAt.current && !ids.has(t.id)).length;
  const filtered = !!(dq || status.length || priority.length || sla.length || category.length || unassigned || techId);

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-panel2 p-1 text-sm" role="tablist" aria-label="Ticket view">
          {([['All tickets', () => setStatus([]), status.length === 0], ['Open', () => setStatus(OPEN_STATUSES), sameSet(status, OPEN_STATUSES)], ['Closed / cancelled', () => setStatus(DONE_STATUSES), sameSet(status, DONE_STATUSES)]] as const).map(([label, go, on]) => (
            <button key={label} type="button" role="tab" aria-selected={on} onClick={go} className={clsx('flex-1 whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition', on ? 'bg-brand text-bg' : 'text-mute hover:text-ink')}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-mute" /><input className="input pl-8" placeholder="Search ticket no, customer, phone, text…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tickets" /></div>
          <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by"><option value="createdAt">Date created</option><option value="number">Ticket number</option><option value="priority">Priority</option><option value="slaDeadline">SLA deadline</option><option value="updatedAt">Recently updated</option></select>
          <button className="btn-ghost" onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')} aria-label="Toggle order">{order === 'desc' ? '↓ Newest first' : '↑ Oldest first'}</button>
          <select className="input !w-auto" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Tickets per page"><option value={15}>15 per page</option><option value={30}>30 per page</option><option value={50}>50 per page</option><option value={100}>100 per page</option></select>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <div><p className="label">Status</p><Chips all={ALL_STATUSES} value={status} onChange={setStatus} label={(s) => STATUS_META[s].label} /></div>
          <div><p className="label">Priority</p><Chips all={ALL_PRIORITIES} value={priority} onChange={setPriority} label={(s) => PRIORITY_META[s].label} /></div>
          <div><p className="label">SLA</p><div className="flex flex-wrap items-center gap-1"><Chips all={SLA_STATES} value={sla} onChange={setSla} label={(s) => s.replace('_', ' ').toLowerCase()} /><button type="button" aria-pressed={unassigned} onClick={() => setUnassigned(!unassigned)} className={clsx('chip transition', unassigned ? 'border-warn bg-warn/15 text-warn' : 'border-line text-mute')}>unassigned</button></div></div>
        </div>
        {categories.length > 0 && <div><p className="label">Category</p><Chips all={categories.map((c) => c.code)} value={category} onChange={setCategory} label={(c) => categories.find((x) => x.code === c)?.name ?? c} /></div>}
        {techId && <p className="text-xs text-mute">Showing tickets of <b className="text-ink">{technicians[techId]?.name ?? 'one technician'}</b></p>}
        {filtered && <button className="btn-ghost !py-1 text-xs" onClick={() => { setQ(''); setStatus([]); setPriority([]); setSla([]); setCategory([]); setUnassigned(false); setTechId(''); }}><X className="h-3 w-3" />Clear filters</button>}
      </div>

      {fresh > 0 && page === 1 && <button onClick={() => void load()} className="btn-primary w-full animate-pulse"><RefreshCw className="h-4 w-4" />{fresh} new ticket{fresh > 1 ? 's' : ''} arrived · show them</button>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>}

      <div className="card overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="p-3">Ticket</th><th>Customer</th><th>Priority</th><th>Status</th><th>SLA</th><th>Technician</th><th className="w-28">Progress</th><th>Created</th></tr></thead>
            <tbody>
              {loading && !res ? Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={8} className="p-2"><div className="skeleton h-8" /></td></tr>) : rows.map((t) => (
                <tr key={t.id} className="border-b border-line/60 transition hover:bg-panel2/60">
                  <td className="p-3"><Link to={`/tickets/${t.id}`} className="font-semibold hover:text-brand"><span className="mono text-xs text-brand">{t.ticketNo}</span><br />{t.title}</Link></td>
                  <td className="text-xs">{t.customer.name}<br /><span className="text-mute">{t.customer.phone}</span></td>
                  <td><PriorityBadge priority={t.priority} escalated={t.escalated} /></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td><SlaBadge state={t.slaState} /></td>
                  <td className="text-xs">{t.technician ? <span className="flex items-center gap-1.5"><Avatar name={t.technician.name} size={20} />{t.technician.name}</span> : <span className="text-mute">—</span>}</td>
                  <td><div className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${t.progress}%` }} /></div></td>
                  <td className="text-xs text-mute">{timeAgo(t.createdAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-line/60 md:hidden">
          {rows.map((t) => (
            <li key={t.id}><Link to={`/tickets/${t.id}`} className="block space-y-1.5 p-3"><div className="flex items-center justify-between"><span className="mono text-xs font-bold text-brand">{t.ticketNo}</span><PriorityBadge priority={t.priority} /></div><p className="text-sm font-semibold">{t.title}</p><div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={t.status} /><SlaBadge state={t.slaState} /></div><p className="text-xs text-mute">{t.customer.name} · {t.technician?.name ?? 'unassigned'} · {t.progress}%</p></Link></li>
          ))}
        </ul>
        {res && rows.length === 0 && <div className="p-10 text-center"><p className="text-sm font-medium">No tickets match</p><p className="text-xs text-mute">{filtered ? 'Try clearing some filters.' : 'Create the first ticket with “New ticket”.'}</p></div>}
        {res && (
          <div className="flex items-center justify-between border-t border-line p-3 text-xs text-mute">
            <span>{res.total} ticket{res.total === 1 ? '' : 's'} · page {res.page}/{res.totalPages}</span>
            <div className="flex gap-1"><button className="btn-ghost !p-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><button className="btn-ghost !p-1.5" disabled={page >= res.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div>
          </div>
        )}
      </div>
    </div>
  );
}
