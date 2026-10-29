import { Contact, Loader2, Pencil, Plus, Search, Ticket as TicketIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, get, patch, post } from '../api/client';
import type { Customer } from '../api/types';
import { Modal } from '../components/Modal';
import { newCustomerSchema, zodErrors } from '../lib/schemas';
import { useUi } from '../store/ui';

type Row = Customer & { ticketCount?: number };
const blank = { name: '', phone: '', address: '', area: '', planMbps: '' };

/** Register customers once, here. Later an operator just picks them when filing a ticket. */
export default function Customers() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ editing: Row | null } | null>(null);

  const load = useCallback(() => get<{ items: Row[] }>(`/customers?limit=200&q=${encodeURIComponent(q.trim())}`).then((r) => { setRows(r.items); setError(null); }).catch((e) => setError(e.message)), [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-xl font-bold"><Contact className="h-5 w-5 text-brand" />Customers</h1><p className="text-sm text-mute">Save a customer’s details once. When a ticket is filed, just pick the customer from the list.</p></div>
        <button className="btn-primary" onClick={() => setDialog({ editing: null })}><Plus className="h-4 w-4" />New customer</button>
      </div>
      <div className="card p-3"><div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-mute" /><input className="input pl-8" placeholder="Search by name, phone or account number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" /></div></div>
      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <div className="card overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="p-3">Customer</th><th>Phone</th><th>Address</th><th>Plan</th><th className="text-right">Tickets</th><th /></tr></thead>
            <tbody>
              {!rows && <tr><td colSpan={6} className="p-3"><div className="skeleton h-8" /></td></tr>}
              {rows?.map((c) => (
                <tr key={c.id} className="border-b border-line/60 hover:bg-panel2/60">
                  <td className="p-3"><p className="font-medium">{c.name}</p><p className="mono text-[11px] text-mute">{c.accountNo}</p></td>
                  <td className="text-xs">{c.phone}</td>
                  <td className="text-xs">{c.address}{c.area ? <span className="text-mute"> · {c.area}</span> : null}</td>
                  <td className="mono text-xs">{c.planMbps} Mbps</td>
                  <td className="mono text-right text-xs"><Link className="hover:text-brand" to={`/tickets?q=${encodeURIComponent(c.accountNo)}`} title="Show this customer’s tickets">{c.ticketCount ?? 0}</Link></td>
                  <td className="pr-3 text-right"><button className="btn-ghost !p-1.5" onClick={() => setDialog({ editing: c })} aria-label={`Edit ${c.name}`}><Pencil className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-line/60 md:hidden">
          {rows?.map((c) => (
            <li key={c.id} className="space-y-1 p-3">
              <div className="flex items-center justify-between"><span className="font-medium">{c.name}</span><button className="btn-ghost !p-1.5" onClick={() => setDialog({ editing: c })} aria-label={`Edit ${c.name}`}><Pencil className="h-3.5 w-3.5" /></button></div>
              <p className="text-xs text-mute">{c.accountNo} · {c.phone} · {c.planMbps} Mbps</p>
              <p className="text-xs">{c.address}{c.area ? ` · ${c.area}` : ''}</p>
              <Link className="inline-flex items-center gap-1 text-xs text-brand" to={`/tickets?q=${encodeURIComponent(c.accountNo)}`}><TicketIcon className="h-3 w-3" />{c.ticketCount ?? 0} tickets</Link>
            </li>
          ))}
        </ul>
        {rows && rows.length === 0 && <div className="p-10 text-center"><p className="text-sm font-medium">{q ? 'No customer matches your search' : 'No customers yet'}</p><p className="text-xs text-mute">Use “New customer” to save the first one.</p></div>}
      </div>
      <CustomerDialog state={dialog} onClose={() => setDialog(null)} onSaved={() => void load()} />
    </div>
  );
}

function CustomerDialog({ state, onClose, onSaved }: { state: { editing: Row | null } | null; onClose: () => void; onSaved: () => void }) {
  const editing = state?.editing ?? null;
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state) return;
    setErrors({}); setBanner(null); setBusy(false);
    setF(editing ? { name: editing.name, phone: editing.phone, address: editing.address, area: editing.area ?? '', planMbps: String(editing.planMbps) } : blank);
  }, [state, editing]);

  const set = (k: keyof typeof blank, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = newCustomerSchema.safeParse({ name: f.name, phone: f.phone, address: f.address, ...(f.area.trim() ? { area: f.area } : {}), planMbps: f.planMbps });
    if (!r.success) { setErrors(zodErrors(r.error)); return; }
    setBusy(true); setBanner(null); setErrors({});
    try {
      if (editing) await patch(`/customers/${editing.id}`, r.data); else await post('/customers', r.data);
      useUi.getState().toast({ kind: 'ok', title: editing ? 'Customer updated' : 'Customer saved', text: r.data.name });
      onSaved(); onClose();
    } catch (ex) {
      if (ex instanceof ApiError) { setErrors(ex.fieldErrors()); setBanner(ex.message); } else setBanner('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  // plain function (not a component) so the input keeps focus while typing
  const field = (id: string, label: string, k: keyof typeof blank, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div key={id}>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} {...extra} />
      {errors[k] && <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p>}
    </div>
  );

  return (
    <Modal open={!!state} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New customer'}>
      <form onSubmit={save} className="space-y-3" noValidate>
        {banner && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}
        {field('cu-name', 'Customer name', 'name')}
        {field('cu-phone', 'Phone', 'phone', { inputMode: 'tel', placeholder: '+8801…' })}
        {field('cu-address', 'Address', 'address')}
        <div className="grid grid-cols-2 gap-3">
          {field('cu-area', 'Area (optional)', 'area')}
          {field('cu-plan', 'Plan speed (Mbps)', 'planMbps', { inputMode: 'numeric' })}
        </div>
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary min-w-[130px]" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? 'Save changes' : 'Save customer'}</button></div>
      </form>
    </Modal>
  );
}
