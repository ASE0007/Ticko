import { Loader2, Plus, Search, UserRoundPlus } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useId, useState } from 'react';
import clsx from 'clsx';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, get, patch, post } from '../api/client';
import type { CategoryInfo, Customer, PlanTemplate, Priority, Ticket } from '../api/types';
import { Modal } from './Modal';
import { PRIORITY_META, ALL_PRIORITIES, PLAN_TEMPLATE_LABEL, PLAN_TEMPLATE_STEPS, findSimilarCategory } from '../lib/format';
import { ticketFormSchema, zodErrors } from '../lib/schemas';
import { useUi } from '../store/ui';
import { useData } from '../store/data';
import { isManager, useAuth } from '../store/auth';

const empty = { title: '', description: '', category: '' as string, priority: 'MEDIUM' as Priority, name: '', phone: '', address: '', area: '', planMbps: '' };

/** Label is programmatically tied to its control (screen readers, click-to-focus) and errors are announced. */
function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  const id = useId();
  const isControl = isValidElement(children) && typeof children.type === 'string' && ['input', 'textarea', 'select'].includes(children.type);
  const control = isControl
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, { id, 'aria-describedby': error ? `${id}-err` : undefined })
    : children;
  return (
    <div>
      <label className="label" htmlFor={isControl ? id : undefined}>{label}</label>
      {control}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function NewTicketDrawer() {
  const open = useUi((s) => s.newTicketOpen);
  const close = () => useUi.getState().openNewTicket(false);
  const nav = useNavigate();
  const manager = isManager(useAuth((st) => st.user));
  const allCategories = useData((st) => st.categories);
  const categories = allCategories.filter((c) => c.active);
  const [newCat, setNewCat] = useState<{ name: string; planTemplate: PlanTemplate } | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [f, setF] = useState(empty);
  const [picked, setPicked] = useState<Customer | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setF({ ...empty, category: useData.getState().categories.find((c) => c.active)?.code ?? '' }); setNewCat(null); setCatError(null); setPicked(null); setQ(''); setErrors({}); setTouched({}); setBanner(null); setMode('existing');
  }, [open]);

  // debounced customer search
  useEffect(() => {
    if (!open || mode !== 'existing') return;
    const t = setTimeout(() => { get<{ items: Customer[] }>(`/customers?q=${encodeURIComponent(q)}`).then((r) => setResults(r.items)).catch(() => setResults([])); }, 250);
    return () => clearTimeout(t);
  }, [q, open, mode]);

  const set = (k: keyof typeof empty, v: string) => setF((s) => ({ ...s, [k]: v }));
  const pickCategory = (code: string) => {
    const c = categories.find((x) => x.code === code);
    setF((s) => ({ ...s, category: code, ...(c ? { priority: c.defaultPriority } : {}) })); // each category suggests a priority
  };
  const similar = newCat ? findSimilarCategory(newCat.name, allCategories) : undefined;
  const useExisting = async () => {
    if (!similar) return;
    try {
      if (!similar.active) { await patch(`/categories/${similar.code}`, { active: true }); const list = await get<{ items: CategoryInfo[] }>('/categories?all=true'); useData.getState().setCategories(list.items); }
      setF((st) => ({ ...st, category: similar.code, priority: similar.defaultPriority })); setNewCat(null); setCatError(null);
    } catch (e) { setCatError(e instanceof ApiError ? e.message : 'Could not use this category'); }
  };
  const addCategory = async () => {
    if (!newCat || newCat.name.trim().length < 2) { setCatError('Give the category a name (2+ characters)'); return; }
    if (similar) { setCatError(`“${similar.name}” already exists. Use it instead of adding it again.`); return; }
    try {
      const r = await post<{ category: CategoryInfo }>('/categories', { name: newCat.name.trim(), planTemplate: newCat.planTemplate });
      const list = await get<{ items: CategoryInfo[] }>('/categories?all=true');
      useData.getState().setCategories(list.items);
      pickCategory(r.category.code); setNewCat(null); setCatError(null);
      useUi.getState().toast({ kind: 'ok', title: `Category “${r.category.name}” added` });
    } catch (e) { setCatError(e instanceof ApiError ? e.message : 'Could not add category'); }
  };

  const build = () => ({
    title: f.title, description: f.description, category: f.category, priority: f.priority,
    ...(mode === 'existing' ? { customerId: picked?.id } : { customer: { name: f.name, phone: f.phone, address: f.address, ...(f.area ? { area: f.area } : {}), planMbps: f.planMbps } }),
  });

  const validate = (): { ok: boolean; data?: ReturnType<typeof ticketFormSchema.parse> } => {
    const r = ticketFormSchema.safeParse(build());
    if (r.success) { setErrors({}); return { ok: true, data: r.data }; }
    setErrors(zodErrors(r.error));
    return { ok: false };
  };

  const blur = (k: string) => { setTouched((t) => ({ ...t, [k]: true })); validate(); };
  const err = (k: string) => (touched[k] ? errors[k] : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ title: true, description: true, customerId: true, 'customer.name': true, 'customer.phone': true, 'customer.address': true, 'customer.planMbps': true });
    const v = validate();
    if (!v.ok || !v.data) return;
    setBusy(true); setBanner(null);
    try {
      const res = await post<{ ticket: Ticket }>('/tickets', v.data);
      useData.getState().upsertTicket(res.ticket);
      useUi.getState().toast({ kind: 'ok', title: `Ticket ${res.ticket.ticketNo} created`, text: 'Automatic diagnostics started in the background' });
      close();
      nav(`/tickets/${res.ticket.id}`);
    } catch (ex) {
      if (ex instanceof ApiError) { setErrors(ex.fieldErrors()); setTouched((t) => ({ ...t, ...Object.fromEntries(Object.keys(ex.fieldErrors()).map((k) => [k, true])) })); setBanner(ex.message); }
      else setBanner('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  const ready = ticketFormSchema.safeParse(build()).success;

  return (
    <Modal open={open} onClose={close} title="New service request" wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {banner && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}

        <div className="flex gap-1 rounded-lg bg-panel2 p-1 text-sm" role="tablist">
          {(['existing', 'new'] as const).map((m) => (
            <button type="button" key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErrors({}); }}
              className={clsx('flex-1 rounded-md px-3 py-1.5 font-medium transition', mode === m ? 'bg-brand text-bg' : 'text-mute hover:text-ink')}>
              {m === 'existing' ? 'Existing customer' : 'New customer'}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <Field label="Find customer (name, phone or account no.)" error={err('customerId')}>
            {picked ? (
              <div className="flex items-center justify-between rounded-lg border border-brand/50 bg-brand/5 px-3 py-2 text-sm">
                <span><b>{picked.name}</b> · {picked.accountNo} · {picked.planMbps} Mbps<br /><span className="text-xs text-mute">{picked.phone} · {picked.address}</span></span>
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPicked(null)}>Change</button>
              </div>
            ) : (
              <>
                <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-mute" /><input className="input pl-8" placeholder="e.g. Karim, 0171…, ACC-1001" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => blur('customerId')} aria-label="Search customers" /></div>
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line">
                  {results.map((c) => (
                    <li key={c.id}><button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-panel2" onClick={() => setPicked(c)}><span>{c.name} <span className="text-xs text-mute">{c.accountNo}</span></span><span className="mono text-xs text-mute">{c.planMbps} Mbps</span></button></li>
                  ))}
                  {results.length === 0 && <li className="px-3 py-3 text-center text-xs text-mute">No customer found. Use “New customer” above, or save them first on the <Link to="/customers" onClick={close} className="text-brand underline">Customers</Link> page.</li>}
                </ul>
              </>
            )}
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer name" error={err('customer.name')}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} onBlur={() => blur('customer.name')} aria-invalid={!!err('customer.name')} /></Field>
            <Field label="Phone" error={err('customer.phone')}><input className="input" inputMode="tel" placeholder="+8801…" value={f.phone} onChange={(e) => set('phone', e.target.value)} onBlur={() => blur('customer.phone')} aria-invalid={!!err('customer.phone')} /></Field>
            <div className="sm:col-span-2"><Field label="Address" error={err('customer.address')}><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} onBlur={() => blur('customer.address')} aria-invalid={!!err('customer.address')} /></Field></div>
            <Field label="Area (optional)"><input className="input" value={f.area} onChange={(e) => set('area', e.target.value)} /></Field>
            <Field label="Plan speed (Mbps)" error={err('customer.planMbps')}><input className="input" inputMode="numeric" value={f.planMbps} onChange={(e) => set('planMbps', e.target.value)} onBlur={() => blur('customer.planMbps')} aria-invalid={!!err('customer.planMbps')} /></Field>
          </div>
        )}

        <Field label="What is the problem? (short title)" error={err('title')}><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} onBlur={() => blur('title')} aria-invalid={!!err('title')} placeholder="e.g. Internet very slow after 8 PM" maxLength={120} /></Field>
        <Field label="Details" error={err('description')}><textarea className="input min-h-[84px]" value={f.description} onChange={(e) => set('description', e.target.value)} onBlur={() => blur('description')} aria-invalid={!!err('description')} placeholder="What did the customer report? Since when? Any lights on the router?" /></Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" error={err('category')}>
            <div className="space-y-1.5">
              <select className="input" value={f.category} onChange={(e) => pickCategory(e.target.value)} aria-invalid={!!err('category')}>
                {categories.length === 0 && <option value="">No categories yet</option>}
                {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              {manager && !newCat && <button type="button" className="text-xs text-brand hover:underline" onClick={() => setNewCat({ name: '', planTemplate: 'UNKNOWN' })}><Plus className="mr-0.5 inline h-3 w-3" />Add a new category</button>}
              {newCat && (
                <div className="space-y-2 rounded-lg border border-brand/40 bg-brand/5 p-2.5">
                  <input className="input" placeholder="e.g. Fiber cut, Static IP request…" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} aria-label="New category name" />
                  <select className="input text-xs" value={newCat.planTemplate} onChange={(e) => setNewCat({ ...newCat, planTemplate: e.target.value as PlanTemplate })} aria-label="Work plan template">
                    {Object.entries(PLAN_TEMPLATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <p className="text-[11px] text-mute"><b>Steps made for it:</b> {PLAN_TEMPLATE_STEPS[newCat.planTemplate]}</p>
                  {similar && <p role="status" className="rounded border border-warn/40 bg-warn/10 p-1.5 text-xs text-warn">“{similar.name}” already exists{similar.active ? '' : ' (switched off)'}. <button type="button" className="underline" onClick={() => void useExisting()}>{similar.active ? 'Use it' : 'Switch it on and use it'}</button></p>}
                  {catError && <p role="alert" className="text-xs text-danger">{catError}</p>}
                  <div className="flex gap-2"><button type="button" className="btn-primary !py-1 text-xs" onClick={addCategory} disabled={!!similar}>Add category</button><button type="button" className="btn-ghost !py-1 text-xs" onClick={() => { setNewCat(null); setCatError(null); }}>Cancel</button></div>
                </div>
              )}
            </div>
          </Field>
          <Field label="Priority (sets the SLA deadline)">
            <div className="flex gap-1">
              {ALL_PRIORITIES.map((p) => (
                <button type="button" key={p} aria-pressed={f.priority === p} onClick={() => set('priority', p)}
                  className={clsx('flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition', f.priority === p ? `${PRIORITY_META[p].cls} ring-2 ring-brand/50` : 'border-line text-mute hover:text-ink')}>{PRIORITY_META[p].label}</button>
              ))}
            </div>
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" className="btn-primary min-w-[140px]" disabled={busy || !ready}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPlus className="h-4 w-4" />}Create ticket
          </button>
        </div>
      </form>
    </Modal>
  );
}
