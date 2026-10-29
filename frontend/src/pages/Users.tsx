import { Plus, Search, UserCog } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { get } from '../api/client';
import type { Role, UserRow } from '../api/types';
import { Avatar } from '../components/Badges';
import { UserDialog } from '../components/UserDialog';
import { useAuth } from '../store/auth';

const ROLE_CLS: Record<Role, string> = { ADMIN: 'text-crit border-crit/40', SUPERVISOR: 'text-warn border-warn/40', OPERATOR: 'text-info border-info/40', TECHNICIAN: 'text-brand border-brand/40' };
const ROLES: Role[] = ['TECHNICIAN', 'OPERATOR', 'SUPERVISOR', 'ADMIN'];

/** Admin: create accounts (each technician gets an individual e-mail + password), edit, reset passwords, deactivate. */
export default function Users() {
  const me = useAuth((s) => s.user)!;
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [dialog, setDialog] = useState<{ editing: UserRow | null } | null>(null);

  const load = useCallback(() => get<{ items: UserRow[] }>('/users').then((r) => { setRows(r.items); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((u) => (!role || u.role === role) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))), [rows, role, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-xl font-bold"><UserCog className="h-5 w-5 text-brand" />Users & access</h1><p className="text-sm text-mute">Every person has their own e-mail and password. Admins create accounts, reset passwords and switch people off.</p></div>
        <button className="btn-primary" onClick={() => setDialog({ editing: null })}><Plus className="h-4 w-4" />New user</button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-mute" /><input className="input pl-8" placeholder="Search name or e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></div>
        <div className="flex flex-wrap gap-1">{ROLES.map((r) => <button key={r} aria-pressed={role === r} onClick={() => setRole(role === r ? null : r)} className={clsx('chip transition', role === r ? 'border-brand bg-brand/15 text-brand' : 'border-line text-mute hover:text-ink')}>{r.toLowerCase()}</button>)}</div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="p-3">Person</th><th>Role</th><th>Skills / capacity</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!rows && Array.from({ length: 5 }, (_, i) => <tr key={i}><td colSpan={5} className="p-2"><div className="skeleton h-10" /></td></tr>)}
            {shown.map((u) => (
              <tr key={u.id} className={clsx('border-b border-line/60', !u.active && 'opacity-55')}>
                <td className="p-3"><span className="flex items-center gap-2.5"><Avatar name={u.name} size={32} /><span><span className="block font-medium">{u.name}{u.id === me.id && <span className="ml-1.5 text-[10px] text-mute">(you)</span>}</span><span className="block text-xs text-mute">{u.email}</span></span></span></td>
                <td><span className={clsx('chip', ROLE_CLS[u.role])}>{u.role.toLowerCase()}</span></td>
                <td className="text-xs text-mute">{u.role === 'TECHNICIAN' ? <>{u.skills.join(' · ') || '—'}<br />load {u.activeTickets ?? 0}/{u.maxActive}</> : '—'}</td>
                <td><span className={clsx('chip', u.active ? 'border-ok/40 text-ok' : 'border-line text-mute')}>{u.active ? 'Active' : 'Disabled'}</span></td>
                <td className="pr-3 text-right"><button className="btn-ghost !py-1 text-xs" onClick={() => setDialog({ editing: u })} aria-label={`Edit ${u.name}`}>Edit</button></td>
              </tr>
            ))}
            {rows && shown.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-sm text-mute">No users match.</td></tr>}
          </tbody>
        </table>
      </div>
      <UserDialog open={!!dialog} editing={dialog?.editing ?? null} onClose={() => setDialog(null)} onSaved={() => void load()} />
    </div>
  );
}
