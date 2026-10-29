import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, HardHat, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, get, post } from '../api/client';
import type { Tracking, WsMessage } from '../api/types';
import { ProgressRing } from '../components/Rings';
import { RealtimeClient } from '../ws/socket';
import { STATUS_META } from '../lib/format';

const WORDS: Record<string, (n: string | null) => { head: string; sub: string }> = {
  OPEN: () => ({ head: 'We received your request', sub: 'Our system is starting automatic checks on your line.' }),
  DIAGNOSING: () => ({ head: 'Checking your connection', sub: 'Automatic diagnostics are running right now.' }),
  AWAITING_ASSIGNMENT: () => ({ head: 'Finding the right technician', sub: 'We are choosing the best available engineer for your issue.' }),
  ASSIGNED: (n) => ({ head: `${n ?? 'A technician'} is assigned`, sub: 'Work will start shortly.' }),
  IN_PROGRESS: (n) => ({ head: `${n ?? 'Our technician'} is working on it`, sub: 'We will keep this page updated live.' }),
  VERIFYING: () => ({ head: 'Testing your speed', sub: 'Making sure you get the speed you pay for.' }),
  RESOLVED: () => ({ head: 'We think it is fixed!', sub: 'Please confirm that your internet works well now.' }),
  CLOSED: () => ({ head: 'All done. Thank you!', sub: 'This request is closed.' }),
  REOPENED: () => ({ head: 'We are looking at it again', sub: 'Sorry about that. A supervisor will assign it to someone.' }),
  CANCELLED: () => ({ head: 'This request was cancelled', sub: 'Please contact us if this is a mistake.' }),
};

/** Public customer page: no login, live over WebSocket using the private tracking token. */
export default function Track() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [busy, setBusy] = useState<'ok' | 'bad' | null>(null);
  const [note, setNote] = useState('');
  const [askNote, setAskNote] = useState(false);

  const load = useCallback(() => get<Tracking>(`/public/track/${token}`).then(setData).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'This tracking link is not valid.' : 'Could not load your request.')), [token]);

  useEffect(() => {
    void load();
    const onMessage = (m: WsMessage) => {
      const p = m.payload ?? {};
      if (p.ticket) setData((d) => (d ? { ...d, ticket: { ...d.ticket, ...p.ticket } } : d));
      else if (m.type === 'job.progress' && typeof p.progress === 'number') setData((d) => (d ? { ...d, ticket: { ...d.ticket, progress: p.ticketProgress ?? p.progress } } : d));
      if (m.type.startsWith('ticket.')) void load(); // status changed: refresh timeline & response buttons
    };
    const c = new RealtimeClient({ trackToken: token }, { onMessage, onStatus: setLive, trackStatus: false });
    c.connect();
    return () => c.close();
  }, [token, load]);

  const respond = async (ok: boolean) => {
    setBusy(ok ? 'ok' : 'bad');
    try { await post(`/public/track/${token}/${ok ? 'confirm' : 'report-issue'}`, ok ? {} : { note }); await load(); setAskNote(false); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); } finally { setBusy(null); }
  };

  if (error && !data) return <div className="grid min-h-full place-items-center p-6"><div className="card max-w-sm p-8 text-center"><p className="font-semibold">{error}</p></div></div>;
  if (!data) return <div className="grid min-h-full place-items-center"><Loader2 className="h-8 w-8 animate-spin text-brand" /></div>;

  const t = data.ticket;
  const words = (WORDS[t.status] ?? WORDS['OPEN']!)(t.technicianFirstName);
  const done = t.status === 'CLOSED';

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col gap-4 p-4">
      <header className="flex items-center justify-between pt-2"><span className="flex items-center gap-2 font-bold"><HardHat className="h-5 w-5 text-brand" />Tick<span className="text-brand">o</span></span><span className={`chip border-current/30 ${live === 'live' ? 'text-ok' : 'text-warn'}`}><span className={`h-2 w-2 rounded-full ${live === 'live' ? 'bg-ok' : 'animate-pulse bg-warn'}`} />{live === 'live' ? 'Live' : 'Reconnecting…'}</span></header>
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-col items-center gap-4 p-6 text-center">
        <p className="text-sm text-mute">Hi {t.customerFirstName}, here is your request <span className="mono font-bold text-brand">{t.ticketNo}</span></p>
        <ProgressRing value={done ? 100 : t.progress} size={150} stroke={12} color={done ? 'rgb(var(--ok))' : 'rgb(var(--brand))'}>{done ? <CheckCircle2 className="h-12 w-12 text-ok" /> : <span className="text-3xl font-bold mono">{t.progress}%</span>}</ProgressRing>
        <AnimatePresence mode="wait"><motion.div key={t.status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}><h1 className="text-xl font-bold">{words.head}</h1><p className="mt-1 text-sm text-mute">{words.sub}</p></motion.div></AnimatePresence>
        <span className={`chip ${STATUS_META[t.status].cls}`}>{STATUS_META[t.status].label}</span>
        {t.forecastFinish && !done && <p className="text-xs text-mute">Estimated completion around <b className="text-ink">{new Date(t.forecastFinish).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></p>}
      </motion.section>

      {data.customerCanRespond && (
        <motion.section initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card space-y-3 border-ok/50 p-5">
          <p className="text-center font-semibold">Is your internet working well now?</p>
          {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}
          {askNote && <textarea className="input" placeholder="Tell us what is still wrong (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary !bg-ok !py-3" disabled={busy !== null} onClick={() => respond(true)}>{busy === 'ok' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}Yes, fixed</button>
            <button className="btn-danger !py-3" disabled={busy !== null} onClick={() => (askNote ? respond(false) : setAskNote(true))}>{busy === 'bad' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}{askNote ? 'Send' : 'Still broken'}</button>
          </div>
        </motion.section>
      )}

      <section className="card p-4"><h2 className="mb-3 text-sm font-semibold">What happened so far</h2>
        <ol className="space-y-2 border-l border-line pl-4">{[...data.timeline].reverse().map((e, i) => <li key={i} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" />{(STATUS_META as Record<string, { label: string }>)[e.status]?.label ?? e.status}<span className="ml-2 text-xs text-mute">{new Date(e.at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span></li>)}</ol>
      </section>
    </div>
  );
}
