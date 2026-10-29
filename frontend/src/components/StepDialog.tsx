import { ArrowRight, GitBranch, ListOrdered, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ApiError, patch, post } from '../api/client';
import type { Step } from '../api/types';
import { Modal } from './Modal';

type Mode = 'parallel' | 'after' | 'insert';

/** All steps that (directly or indirectly) wait for `id`: they must not become its prerequisites (cycle). */
export function descendantsOf(id: string, steps: Step[]): Set<string> {
  const out = new Set<string>();
  const walk = (cur: string) => { for (const s of steps) if (s.dependsOn.includes(cur) && !out.has(s.id)) { out.add(s.id); walk(s.id); } };
  walk(id);
  return out;
}

/**
 * Add a step or edit one. The key question is always "when can this step begin?":
 *   1. right away (in parallel with others)   2. after specific step(s) finish   3. inserted into the chain after step N
 */
export function StepDialog({ open, onClose, ticketId, steps, editing }: { open: boolean; onClose: () => void; ticketId: string; steps: Step[]; editing?: Step | null }) {
  const [title, setTitle] = useState('');
  const [est, setEst] = useState('15');
  const [mode, setMode] = useState<Mode>('after');
  const [afterIds, setAfterIds] = useState<string[]>([]);
  const [insertId, setInsertId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    if (!editing) return steps;
    const bad = descendantsOf(editing.id, steps);
    return steps.filter((s) => s.id !== editing.id && !bad.has(s.id));
  }, [steps, editing]);
  const locked = !!editing && (editing.status === 'IN_PROGRESS'); // dependencies of a running step cannot change

  useEffect(() => {
    if (!open) return;
    setErr(null); setBusy(false);
    if (editing) { setTitle(editing.title); setEst(String(editing.estimatedMinutes)); setMode(editing.dependsOn.length ? 'after' : 'parallel'); setAfterIds(editing.dependsOn); }
    else {
      const last = steps[steps.length - 1];
      setTitle(''); setEst('15'); setMode(last ? 'after' : 'parallel'); setAfterIds(last ? [last.id] : []); setInsertId(last?.id ?? '');
    }
  }, [open, editing, steps]);

  const label = (s: Step) => `#${s.seq} ${s.title}`;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const waitingForInsert = steps.filter((s) => s.dependsOn.includes(insertId) && (s.status === 'LOCKED' || s.status === 'READY'));

  const preview = (() => {
    const name = title.trim() || 'this step';
    if (mode === 'parallel') return <>“{name}” can <b>start at once</b>. It can run at the same time as other steps.</>;
    if (mode === 'after') return afterIds.length ? <>“{name}” will start only after {afterIds.map((i) => <b key={i} className="mx-0.5">{byId.get(i) ? label(byId.get(i)!) : '?'}</b>)} {afterIds.length > 1 ? 'are' : 'is'} finished.</> : <span className="text-warn">Pick at least one step it must wait for, or choose “Start at once”.</span>;
    const after = byId.get(insertId);
    return after ? (
      <span className="flex flex-wrap items-center gap-1.5"><b>{label(after)}</b><ArrowRight className="h-3 w-3" /><b className="rounded bg-brand/20 px-1.5 text-brand">NEW: {name}</b>{waitingForInsert.length > 0 && <><ArrowRight className="h-3 w-3" />{waitingForInsert.map((w) => <b key={w.id}>{label(w)}</b>)}<span className="text-mute">(will now wait for the new step)</span></>}</span>
    ) : <span className="text-warn">Choose the step it should come after.</span>;
  })();

  const save = async () => {
    const n = Number(est);
    if (title.trim().length < 3) return setErr('Please write a step name (at least 3 letters).');
    if (!Number.isInteger(n) || n < 1 || n > 1440) return setErr('Write the time as a whole number of minutes (from 1 to 1440).');
    if (mode === 'after' && afterIds.length === 0) return setErr('Choose which step(s) it must wait for, or pick “Start at once”.');
    if (mode === 'insert' && !insertId) return setErr('Choose the step it should come after.');
    setBusy(true); setErr(null);
    try {
      if (editing) await patch(`/steps/${editing.id}`, { title: title.trim(), estimatedMinutes: n, version: editing.version, ...(locked ? {} : { dependsOn: mode === 'parallel' ? [] : afterIds }) });
      else await post(`/tickets/${ticketId}/steps`, { title: title.trim(), estimatedMinutes: n, dependsOn: mode === 'after' ? afterIds : [], ...(mode === 'insert' ? { insertAfter: insertId } : {}) });
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === 'DEPENDENCY_CYCLE' ? 'These steps would wait for each other forever. Please pick a different step.' : e.code === 'VERSION_CONFLICT' ? 'Someone else changed this step. Close this window and open it again.' : e.message) : 'Failed');
    } finally { setBusy(false); }
  };

  const Option = ({ value, icon: Icon, title: t, hint, disabled }: { value: Mode; icon: typeof Zap; title: string; hint: string; disabled?: boolean }) => (
    <button type="button" role="radio" aria-checked={mode === value} disabled={disabled} onClick={() => setMode(value)}
      className={clsx('flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition disabled:opacity-40', mode === value ? 'border-brand bg-brand/10 ring-1 ring-brand/40' : 'border-line hover:bg-panel2')}>
      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', mode === value ? 'text-brand' : 'text-mute')} />
      <span><span className="block text-sm font-medium">{t}</span><span className="block text-[11px] text-mute">{hint}</span></span>
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit step #${editing.seq}` : 'Add work step'} wide>
      <div className="space-y-4">
        {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div><label className="label" htmlFor="step-title">Step name</label><input id="step-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Replace patch cord" /></div>
          <div><label className="label" htmlFor="step-est">How many minutes will it take?</label><input id="step-est" className="input" inputMode="numeric" value={est} onChange={(e) => setEst(e.target.value)} /></div>
        </div>

        <div>
          <p className="label">When can this step begin?</p>
          <div role="radiogroup" aria-label="When can this step begin" className="space-y-2">
            <Option value="parallel" icon={Zap} title="Start at once (at the same time as others)" hint="It does not wait for any other step. Another technician can do it at the same time." disabled={locked} />
            <Option value="after" icon={ListOrdered} title="Start after other steps" hint="It stays locked until all the steps you pick are finished." disabled={locked} />
            {!editing && <Option value="insert" icon={GitBranch} title="Put it between steps" hint="Add it right after one step. Steps that were waiting for that step will now wait for this new step instead." />}
          </div>
        </div>

        {mode === 'after' && !locked && (
          <div className="space-y-1 rounded-lg border border-line p-2.5" role="group" aria-label="Wait for">
            {candidates.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-panel2">
                <input type="checkbox" checked={afterIds.includes(s.id)} onChange={(e) => setAfterIds(e.target.checked ? [...afterIds, s.id] : afterIds.filter((d) => d !== s.id))} />
                <span className="mono text-xs text-mute">#{s.seq}</span>{s.title}<span className="ml-auto text-[11px] text-mute">{s.status.toLowerCase().replace('_', ' ')}</span>
              </label>
            ))}
            {candidates.length === 0 && <p className="text-xs text-mute">No other steps yet.</p>}
          </div>
        )}
        {mode === 'insert' && !editing && (
          <div><label className="label" htmlFor="insert-after">Insert right after</label>
            <select id="insert-after" className="input" value={insertId} onChange={(e) => setInsertId(e.target.value)}>{steps.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</select></div>
        )}
        {locked && <p className="text-xs text-mute">This step has already started, so you can only change its name and time.</p>}

        <div className="rounded-lg bg-panel2 p-3 text-sm" aria-live="polite"><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mute">What will happen</p>{preview}</div>

        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{editing ? 'Save step' : 'Add step'}</button></div>
      </div>
    </Modal>
  );
}
