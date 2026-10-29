import { motion } from 'framer-motion';
import { HardHat, Loader2, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError, post } from '../api/client';
import type { User } from '../api/types';
import { loginSchema, zodErrors } from '../lib/schemas';
import { useAuth } from '../store/auth';

const DEMO = [
  ['Supervisor', 'supervisor@tixory.test'], ['Operator', 'operator1@tixory.test'], ['Technician', 'nusrat@tixory.test'], ['Admin', 'admin@tixory.test'],
] as const;

export default function Login() {
  const { token, user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  if (token && user) return <Navigate to={user.role === 'TECHNICIAN' ? '/my-work' : '/'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) { setErrors(zodErrors(parsed.error)); return; }
    setErrors({}); setBusy(true); setBanner(null);
    try {
      const r = await post<{ token: string; user: User }>('/auth/login', parsed.data);
      login(r.token, r.user);
      nav(r.user.role === 'TECHNICIAN' ? '/my-work' : '/', { replace: true });
    } catch (ex) {
      setBanner(ex instanceof ApiError ? ex.message : 'Could not sign in.');
    } finally { setBusy(false); }
  };

  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden p-4">
      <motion.div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }} transition={{ duration: 8, repeat: Infinity }} />
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 24 }} className="card relative w-full max-w-md p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/15 text-brand"><HardHat className="h-6 w-6" /></span>
          <div><h1 className="text-xl font-bold">Tick<span className="text-brand">o</span></h1><p className="text-xs text-mute">Real-time service operations command center</p></div>
        </div>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {banner && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}
          <div><label className="label" htmlFor="email">E-mail</label><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors['email']} />{errors['email'] && <p role="alert" className="mt-1 text-xs text-danger">{errors['email']}</p>}</div>
          <div><label className="label" htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors['password']} />{errors['password'] && <p role="alert" className="mt-1 text-xs text-danger">{errors['password']}</p>}</div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}Sign in</button>
        </form>
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-xs text-mute">Demo accounts (password <span className="mono text-ink">Passw0rd!</span>)</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map(([label, mail]) => (
              <button key={mail} type="button" className="btn-ghost text-xs" onClick={() => { setEmail(mail); setPassword('Passw0rd!'); setErrors({}); }}>{label}</button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
