import { Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { api, ApiError, get, patch, post } from '../api/client';
import type { CategoryInfo, PlanTemplate, Priority, SlaPolicyRow } from '../api/types';
import { ALL_PRIORITIES, PLAN_TEMPLATE_LABEL, PLAN_TEMPLATE_STEPS, PRIORITY_META, findSimilarCategory, fmtMinutes } from '../lib/format';
import { useAuth } from '../store/auth';
import { useData } from '../store/data';
import { useUi } from '../store/ui';

export default function Settings() {
  const isAdmin = useAuth((s) => s.user?.role === 'ADMIN');
  const [cats, setCats] = useState<CategoryInfo[] | null>(null);
  const [policies, setPolicies] = useState<SlaPolicyRow[]>([]);
  const [draft, setDraft] = useState({ name: '', description: '', planTemplate: 'UNKNOWN' as PlanTemplate, defaultPriority: 'MEDIUM' as Priority });
  const [error, setError] = useState<string | null>(null);
  const toast = useUi.getState().toast;

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([get<{ items: CategoryInfo[] }>('/categories?all=true'), get<{ items: SlaPolicyRow[] }>('/sla-policies')]);
    setCats(c.items); useData.getState().setCategories(c.items);
    setPolicies(ALL_PRIORITIES.map((pr) => p.items.find((x) => x.priority === pr)).filter(Boolean) as SlaPolicyRow[]);
  }, []);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

  const same = cats ? findSimilarCategory(draft.name, cats) : undefined;
  const fail = (e: unknown) => toast({ kind: 'danger', title: e instanceof ApiError ? e.message : 'Failed' });
  const add = async () => {
    setError(null);
    if (draft.name.trim().length < 2) return setError('Give the category a name (2+ characters).');
    if (same) return setError(`“${same.name}” already exists, so there is no need to add it again.`);
    try { await post('/categories', { name: draft.name.trim(), description: draft.description.trim() || undefined, planTemplate: draft.planTemplate, defaultPriority: draft.defaultPriority }); setDraft({ ...draft, name: '', description: '' }); await load(); toast({ kind: 'ok', title: 'Category added' }); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
  };
  const upd = async (code: string, body: object) => { try { await patch(`/categories/${code}`, body); await load(); } catch (e) { fail(e); } };
  const del = async (code: string) => { try { await api(`/categories/${code}`, { method: 'DELETE' }); await load(); } catch (e) { fail(e); } };
  const savePolicies = async () => {
    try { await api('/sla-policies', { method: 'PUT', body: { policies } }); toast({ kind: 'ok', title: 'SLA policies saved', text: 'Applies to tickets created from now on' }); } catch (e) { fail(e); }
  };

  return (
    <div className="space-y-5">
      <div><h1 className="flex items-center gap-2 text-xl font-bold"><Settings2 className="h-5 w-5 text-brand" />Settings</h1><p className="text-sm text-mute">Ticket categories and SLA targets.</p></div>

      <section className="card p-4">
        <h2 className="font-semibold">Ticket categories</h2>
        <p className="mb-3 text-xs text-mute">Operators pick from these when filing a ticket. The <b>work plan</b> decides which steps are generated automatically for that kind of problem.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="py-2">Category</th><th>Work plan</th><th>Default priority</th><th className="text-right">Tickets</th><th>Active</th><th /></tr></thead>
            <tbody>
              {!cats && <tr><td colSpan={6} className="py-4"><div className="skeleton h-8" /></td></tr>}
              {cats?.map((c) => (
                <tr key={c.code} className={clsx('border-b border-line/60', !c.active && 'opacity-55')}>
                  <td className="py-2"><p className="font-medium">{c.name}{c.builtin && <span className="chip ml-2 border-line text-mute">built-in</span>}</p><p className="text-[11px] text-mute">{c.description ?? c.code}</p></td>
                  <td><select className="input !py-1 text-xs" value={c.planTemplate} onChange={(e) => void upd(c.code, { planTemplate: e.target.value })} aria-label={`Work plan for ${c.name}`} title={PLAN_TEMPLATE_STEPS[c.planTemplate]}>{Object.entries(PLAN_TEMPLATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                  <td><select className="input !py-1 text-xs" value={c.defaultPriority} onChange={(e) => void upd(c.code, { defaultPriority: e.target.value })} aria-label={`Default priority for ${c.name}`}>{ALL_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></td>
                  <td className="mono text-right text-mute">{c.ticketCount ?? 0}</td>
                  <td><input type="checkbox" checked={c.active} onChange={(e) => void upd(c.code, { active: e.target.checked })} aria-label={`${c.name} active`} /></td>
                  <td className="text-right">{isAdmin && !c.builtin && (c.ticketCount ?? 0) === 0 && <button className="btn-ghost !p-1.5 text-danger" onClick={() => void del(c.code)} aria-label={`Delete ${c.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 rounded-xl border border-dashed border-brand/50 bg-brand/5 p-3">
          <p className="mb-2 text-sm font-medium">Add a new category</p>
          {error && <p role="alert" className="mb-2 text-xs text-danger">{error}</p>}
          {same && (
            <p role="status" className="mb-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
              “{same.name}” already exists{same.active ? '' : ' but it is switched off'}. Work plan: {PLAN_TEMPLATE_LABEL[same.planTemplate] ?? same.planTemplate}.
              {!same.active && <button type="button" className="ml-2 underline" onClick={() => void upd(same.code, { active: true })}>Switch it on</button>}
            </p>
          )}
          <div className="grid gap-2 md:grid-cols-[1.2fr_1.5fr_1.6fr_130px_auto]">
            <input className="input" placeholder="Name, e.g. Fiber cut" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Category name" />
            <input className="input" placeholder="Description (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="Category description" />
            <select className="input text-xs" value={draft.planTemplate} onChange={(e) => setDraft({ ...draft, planTemplate: e.target.value as PlanTemplate })} aria-label="Work plan template">{Object.entries(PLAN_TEMPLATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select className="input text-xs" value={draft.defaultPriority} onChange={(e) => setDraft({ ...draft, defaultPriority: e.target.value as Priority })} aria-label="Default priority">{ALL_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select>
            <button className="btn-primary" onClick={add} disabled={!!same}><Plus className="h-4 w-4" />Add</button>
          </div>
          <p className="mt-2 text-[11px] text-mute"><b>Steps made for this category:</b> {PLAN_TEMPLATE_STEPS[draft.planTemplate]}</p>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">SLA targets</h2><p className="text-xs text-mute">Time allowed to resolve a ticket, by priority. {isAdmin ? 'Only affects new tickets.' : 'Only an admin can change these.'}</p></div>{isAdmin && <button className="btn-primary" onClick={savePolicies}><Save className="h-4 w-4" />Save</button>}</div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          {policies.map((p, i) => (
            <div key={p.priority} className="rounded-xl border border-line p-3">
              <p className={clsx('chip mb-2', PRIORITY_META[p.priority].cls)}>{PRIORITY_META[p.priority].label}</p>
              <label className="label" htmlFor={`sla-${p.priority}`}>Resolve within (minutes)</label>
              <input id={`sla-${p.priority}`} className="input" inputMode="numeric" disabled={!isAdmin} value={p.resolutionMinutes} onChange={(e) => setPolicies(policies.map((x, k) => (k === i ? { ...x, resolutionMinutes: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)))} />
              <p className="mt-1 text-[11px] text-mute">= {fmtMinutes(p.resolutionMinutes)} · warn at {p.warningPct}%</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
