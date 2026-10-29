import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ApiError, patch, post } from '../api/client';
import type { Role, Skill, UserRow } from '../api/types';
import { passwordSchema, userFormSchema, zodErrors } from '../lib/schemas';
import { Modal } from './Modal';

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'TECHNICIAN', label: 'Technician', hint: 'Field engineer: own login, works assigned tickets' },
  { value: 'OPERATOR', label: 'Operator', hint: 'Call-centre agent: files tickets' },
  { value: 'SUPERVISOR', label: 'Supervisor', hint: 'Assigns work, edits plans, sees reports' },
  { value: 'ADMIN', label: 'Admin', hint: 'Full access incl. users and settings' },
];
const SKILLS: Skill[] = ['NETWORK', 'ROUTER', 'FIBER', 'WIFI', 'GENERAL'];

export function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  const core = Array.from(a, (n) => chars[n % chars.length]).join('');
  return `${core}${(a[0]! % 9) + 1}`; // guarantees a digit
}

/** Create a user, or edit one (name, e-mail, role, skills, capacity, active, optional new password). */
export function UserDialog({ open, onClose, editing, onSaved }: { open: boolean; onClose: () => void; editing: UserRow | null; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'TECHNICIAN' as Role, skills: [] as Skill[], maxActive: '2', active: true });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setCreated(null); setCopied(false); setShow(false);
    setF(editing
      ? { name: editing.name, email: editing.email, password: '', role: editing.role, skills: editing.skills, maxActive: String(editing.maxActive ?? 2), active: editing.active }
      : { name: '', email: '', password: generatePassword(), role: 'TECHNICIAN', skills: ['GENERAL'], maxActive: '2', active: true });
  }, [open, editing]);

  const tech = (editing ? editing.role : f.role) === 'TECHNICIAN';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const base = userFormSchema.safeParse({ name: f.name, email: f.email });
    if (!base.success) Object.assign(errs, zodErrors(base.error));
    if (!editing || f.password) { const p = passwordSchema.safeParse(f.password); if (!p.success) errs['password'] = p.error.issues[0]?.message ?? 'Invalid password'; }
    const cap = Number(f.maxActive);
    if (tech && (!Number.isInteger(cap) || cap < 1 || cap > 20)) errs['maxActive'] = 'Capacity must be 1-20';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (editing) {
        await patch(`/users/${editing.id}`, {
          name: f.name.trim(), email: f.email.trim().toLowerCase(), active: f.active,
          ...(f.password ? { password: f.password } : {}),
          ...(editing.role !== 'TECHNICIAN' ? { role: f.role } : { skills: f.skills, maxActive: cap }),
        });
        onSaved(); onClose();
      } else {
        await post('/users', { name: f.name.trim(), email: f.email.trim().toLowerCase(), password: f.password, role: f.role, ...(tech ? { skills: f.skills, maxActive: cap } : {}) });
        setCreated({ email: f.email.trim().toLowerCase(), password: f.password, name: f.name.trim() });
        onSaved();
      }
    } catch (ex) {
      if (ex instanceof ApiError) {
        const fe = ex.fieldErrors();
        setErrors(Object.keys(fe).length ? fe : ex.code === 'EMAIL_IN_USE' ? { email: ex.message } : { form: ex.message });
      } else setErrors({ form: 'Something went wrong' });
    } finally { setBusy(false); }
  };

  if (created) {
    const text = `Ticko login\nName: ${created.name}\nE-mail: ${created.email}\nPassword: ${created.password}\nSign in at ${location.origin}`;
    return (
      <Modal open={open} onClose={onClose} title="Account created">
        <div className="space-y-3">
          <p className="text-sm text-mute">Give these credentials to <b className="text-ink">{created.name}</b>. The password is shown only now; they can change it after signing in.</p>
          <pre className="mono whitespace-pre-wrap rounded-lg bg-panel2 p-3 text-xs">{text}</pre>
          <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); }}>{copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}</button><button className="btn-primary" onClick={onClose}>Done</button></div>
        </div>
      </Modal>
    );
  }

  const err = (k: string) => errors[k];
  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'Create user'} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {errors['form'] && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{errors['form']}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="u-name">Full name</label><input id="u-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!err('name')} />{err('name') && <p role="alert" className="mt-1 text-xs text-danger">{err('name')}</p>}</div>
          <div><label className="label" htmlFor="u-email">E-mail (login)</label><input id="u-email" type="email" className="input" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-invalid={!!err('email')} />{err('email') && <p role="alert" className="mt-1 text-xs text-danger">{err('email')}</p>}</div>
        </div>

        <div>
          <label className="label" htmlFor="u-pass">{editing ? 'Set a new password (leave empty to keep the current one)' : 'Password'}</label>
          <div className="flex gap-2">
            <div className="relative flex-1"><input id="u-pass" type={show ? 'text' : 'password'} className="input pr-9 font-mono" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-invalid={!!err('password')} /><button type="button" className="absolute right-2 top-2 text-mute hover:text-ink" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
            <button type="button" className="btn-ghost" onClick={() => { setF({ ...f, password: generatePassword() }); setShow(true); }}><Wand2 className="h-4 w-4" />Generate</button>
          </div>
          {err('password') && <p role="alert" className="mt-1 text-xs text-danger">{err('password')}</p>}
          {editing && f.password && <p className="mt-1 flex items-center gap-1 text-[11px] text-warn"><KeyRound className="h-3 w-3" />They will be signed out everywhere and must use the new password.</p>}
        </div>

        <div>
          <p className="label">Role</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Role">
            {ROLES.map((r) => {
              const disabled = !!editing && (editing.role === 'TECHNICIAN' || r.value === 'TECHNICIAN') && r.value !== editing.role;
              return (
                <button type="button" key={r.value} role="radio" aria-checked={f.role === r.value} disabled={disabled} onClick={() => setF({ ...f, role: r.value })}
                  className={clsx('rounded-lg border p-2.5 text-left transition disabled:opacity-40', f.role === r.value ? 'border-brand bg-brand/10 ring-1 ring-brand/40' : 'border-line hover:bg-panel2')}>
                  <span className="block text-sm font-medium">{r.label}</span><span className="block text-[11px] text-mute">{r.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {tech && (
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div><p className="label">Skills (used for smart assignment)</p><div className="flex flex-wrap gap-1.5">{SKILLS.map((s) => { const on = f.skills.includes(s); return <button type="button" key={s} aria-pressed={on} onClick={() => setF({ ...f, skills: on ? f.skills.filter((x) => x !== s) : [...f.skills, s] })} className={clsx('chip transition', on ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mute hover:text-ink')}>{s}</button>; })}</div></div>
            <div><label className="label" htmlFor="u-cap">Max active tickets</label><input id="u-cap" className="input" inputMode="numeric" value={f.maxActive} onChange={(e) => setF({ ...f, maxActive: e.target.value })} aria-invalid={!!err('maxActive')} />{err('maxActive') && <p role="alert" className="mt-1 text-xs text-danger">{err('maxActive')}</p>}</div>
          </div>
        )}

        {editing && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line p-2.5 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span><b>Account active</b><span className="block text-[11px] text-mute">Untick to lock this person out immediately (history is kept).</span></span></label>
        )}

        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary min-w-[130px]" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? 'Save changes' : 'Create account'}</button></div>
      </form>
    </Modal>
  );
}
