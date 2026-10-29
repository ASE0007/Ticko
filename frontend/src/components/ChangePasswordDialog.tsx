import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, post } from '../api/client';
import type { User } from '../api/types';
import { passwordSchema } from '../lib/schemas';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import { Modal } from './Modal';

/** Every user can change their own password; the server returns a fresh token so this session continues. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCur(''); setNext(''); setAgain(''); setErrors({}); } }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!cur) errs['currentPassword'] = 'Enter your current password';
    const p = passwordSchema.safeParse(next);
    if (!p.success) errs['newPassword'] = p.error.issues[0]?.message ?? 'Invalid password';
    if (next !== again) errs['again'] = 'Passwords do not match';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await post<{ token: string; user: User }>('/auth/change-password', { currentPassword: cur, newPassword: next });
      useAuth.getState().login(r.token, r.user);
      useUi.getState().toast({ kind: 'ok', title: 'Password changed' });
      onClose();
    } catch (ex) {
      setErrors(ex instanceof ApiError ? { ...ex.fieldErrors(), ...(Object.keys(ex.fieldErrors()).length ? {} : { form: ex.message }) } : { form: 'Could not change password' });
    } finally { setBusy(false); }
  };

  const F = ({ id, label, value, set, err, auto }: { id: string; label: string; value: string; set: (v: string) => void; err?: string | undefined; auto: string }) => (
    <div><label className="label" htmlFor={id}>{label}</label><input id={id} type="password" className="input" autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} aria-invalid={!!err} />{err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}</div>
  );
  return (
    <Modal open={open} onClose={onClose} title="Change my password">
      <form onSubmit={submit} className="space-y-3" noValidate>
        {errors['form'] && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{errors['form']}</p>}
        <F id="cp-cur" label="Current password" value={cur} set={setCur} err={errors['currentPassword']} auto="current-password" />
        <F id="cp-new" label="New password (8+ characters, letters and a number)" value={next} set={setNext} err={errors['newPassword']} auto="new-password" />
        <F id="cp-again" label="Repeat new password" value={again} set={setAgain} err={errors['again']} auto="new-password" />
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Change password</button></div>
      </form>
    </Modal>
  );
}
