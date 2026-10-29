import { motion } from 'framer-motion';
import { ArrowLeft, Ban, Pencil as PencilIcon, CheckCheck, Copy, FastForward, Gauge, Pencil, Play, Plus, RotateCcw, SkipForward, UserPlus, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ApiError, get, patch, post } from '../api/client';
import type { Priority, Step, TicketDetail as Detail, TimelineItem, AppConfig } from '../api/types';
import { useAuth, isManager, isStaff } from '../store/auth';
import { useData, activeJobFor } from '../store/data';
import { useUi } from '../store/ui';
import { Avatar, PriorityBadge, SlaBadge, StatusBadge } from '../components/Badges';
import { ProgressRing, SlaRing } from '../components/Rings';
import { StepGantt } from '../components/StepGantt';
import { Timeline } from '../components/Timeline';
import { AssignDialog } from '../components/AssignDialog';
import { Modal } from '../components/Modal';
import { StepDialog } from '../components/StepDialog';
import { ALL_PRIORITIES, PRIORITY_META, fmtMinutes } from '../lib/format';

const STAGES = [
  { key: 'OPEN', label: 'Reported' }, { key: 'DIAGNOSING', label: 'Diagnosing' }, { key: 'AWAITING_ASSIGNMENT', label: 'Assigning' },
  { key: 'IN_PROGRESS', label: 'Fixing' }, { key: 'VERIFYING', label: 'Verifying' }, { key: 'RESOLVED', label: 'Resolved' }, { key: 'CLOSED', label: 'Closed' },
];
const STAGE_INDEX: Record<string, number> = { OPEN: 0, DIAGNOSING: 1, AWAITING_ASSIGNMENT: 2, REOPENED: 2, ASSIGNED: 3, IN_PROGRESS: 3, VERIFYING: 4, RESOLVED: 5, CLOSED: 6, CANCELLED: -1 };

function Stepper({ status }: { status: string }) {
  const idx = STAGE_INDEX[status] ?? 0;
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Ticket lifecycle">
      {STAGES.map((s, i) => {
        const done = idx > i || status === 'CLOSED';
        const current = idx === i && status !== 'CLOSED';
        return (
          <li key={s.key} className="flex flex-1 items-center gap-1 whitespace-nowrap">
            <motion.span animate={{ scale: current ? 1.1 : 1 }} className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold', done ? 'border-ok bg-ok/20 text-ok' : current ? 'border-brand bg-brand/20 text-brand' : 'border-line text-mute')}>{done ? '✓' : i + 1}</motion.span>
            <span className={clsx('text-[11px]', current ? 'font-semibold text-ink' : 'text-mute')}>{s.label}</span>
            {i < STAGES.length - 1 && <span className="relative mx-1 h-px min-w-[12px] flex-1 bg-line"><motion.span className="absolute inset-y-0 left-0 bg-ok" initial={false} animate={{ width: done ? '100%' : '0%' }} /></span>}
          </li>
        );
      })}
    </ol>
  );
}

function ReasonDialog({ open, title, label, confirm, danger, onClose, onSubmit }: { open: boolean; title: string; label: string; confirm: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setErr(null); } }, [open]);
  const go = async () => {
    if (reason.trim().length < 3) { setErr('Please give a short reason (min 3 characters)'); return; }
    setBusy(true);
    try { await onSubmit(reason.trim()); onClose(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <label className="label" htmlFor="reason">{label}</label>
      <textarea id="reason" className="input min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!err} />
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
      <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Back</button><button className={danger ? 'btn-danger' : 'btn-primary'} onClick={go} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirm}</button></div>
    </Modal>
  );
}

export default function TicketDetail() {
  const { id = '' } = useParams();
  const me = useAuth((s) => s.user)!;
  const manager = isManager(me);
  const staff = isStaff(me);
  const ticket = useData((s) => s.tickets[id]);
  const steps = useData((s) => s.steps[id]) ?? [];
  const job = useData((s) => activeJobFor(s.jobs, id));
  const [detail, setDetail] = useState<Detail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assign, setAssign] = useState(false);
  const [dialog, setDialog] = useState<null | 'cancel' | 'reopen' | 'edit' | 'step'>(null);
  const [editStep, setEditStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [simulate, setSimulate] = useState<'' | 'PASS' | 'FAIL'>('');

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (e) { useUi.getState().toast({ kind: e instanceof ApiError && e.status === 409 ? 'warn' : 'danger', title: e instanceof ApiError ? e.message : 'Action failed' }); } finally { setBusy(null); }
  };

  // initial load (REST) -> push into the shared stores; afterwards WebSocket keeps it fresh
  useEffect(() => {
    let live = true;
    setError(null);
    get<Detail>(`/tickets/${id}`).then((d) => {
      if (!live) return;
      setDetail(d);
      useData.getState().upsertTicket(d.ticket);
      useData.getState().setSteps(id, d.steps, d.forecast);
    }).catch((e) => live && setError(e instanceof ApiError ? e.message : 'Failed to load ticket'));
    get<AppConfig>('/config').then((c) => live && setCfg(c)).catch(() => undefined);
    return () => { live = false; };
  }, [id]);

  // re-read the audit timeline + assignments only when the ticket actually changed (event-driven, debounced)
  const stamp = ticket ? `${ticket.version}:${ticket.status}:${ticket.technician?.id ?? ''}:${steps.map((s) => s.status).join('')}` : '';
  useEffect(() => {
    if (!ticket) return;
    const t = setTimeout(() => {
      get<{ items: TimelineItem[] }>(`/tickets/${id}/timeline`).then((r) => setTimeline(r.items)).catch(() => undefined);
      get<Detail>(`/tickets/${id}`).then((d) => setDetail(d)).catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const mineOrManager = manager || (me.role === 'TECHNICIAN' && ticket?.technician?.id === me.technicianId);
  const allDone = steps.length > 0 && steps.every((s) => s.status === 'DONE' || s.status === 'SKIPPED');
  const workable = ticket?.status === 'ASSIGNED' || ticket?.status === 'IN_PROGRESS';
  const terminal = ticket?.status === 'CLOSED' || ticket?.status === 'CANCELLED';

  const stepActions = (s: Step) => (
    <div className="flex gap-1">
      {workable && s.status === 'READY' && (mineOrManager || s.assigneeId === me.technicianId) && <button className="btn-primary !px-2 !py-1 text-xs" disabled={busy === s.id} onClick={() => run(s.id, () => post(`/steps/${s.id}/start`))}><Play className="h-3 w-3" />Start</button>}
      {s.status === 'IN_PROGRESS' && (mineOrManager || s.assigneeId === me.technicianId) && <button className="btn-primary !bg-ok !px-2 !py-1 text-xs" disabled={busy === s.id} onClick={() => run(s.id, () => post(`/steps/${s.id}/complete`))}><CheckCheck className="h-3 w-3" />Complete</button>}
      {manager && s.status !== 'DONE' && s.status !== 'SKIPPED' && !terminal && <button className="btn-ghost !px-2 !py-1 text-xs" title="Edit step (estimate / what it waits for)" aria-label={`Edit step ${s.seq}`} onClick={() => { setEditStep(s); setDialog('step'); }}><PencilIcon className="h-3 w-3" /></button>}
      {manager && (s.status === 'READY' || s.status === 'LOCKED') && !terminal && <button className="btn-ghost !px-2 !py-1 text-xs" title="Skip this step" disabled={busy === s.id} onClick={() => run(s.id, () => post(`/steps/${s.id}/skip`))}><SkipForward className="h-3 w-3" /></button>}
    </div>
  );

  const trackUrl = useMemo(() => (detail?.trackToken ? `${location.origin}/track/${detail.trackToken}` : null), [detail]);

  if (error) return <div className="card mx-auto max-w-md p-8 text-center"><p className="font-semibold">{error}</p><Link to="/tickets" className="btn-ghost mt-4">Back to tickets</Link></div>;
  if (!ticket) return <div className="space-y-3"><div className="skeleton h-28" /><div className="skeleton h-64" /></div>;

  return (
    <div className="space-y-4">
      <Link to={staff ? '/tickets' : '/my-work'} className="inline-flex items-center gap-1 text-xs text-mute hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />Back</Link>

      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><span className="mono text-lg font-bold text-brand">{ticket.ticketNo}</span><StatusBadge status={ticket.status} /><PriorityBadge priority={ticket.priority} escalated={ticket.escalated} /><SlaBadge state={ticket.slaState} />{ticket.reopenCount > 0 && <span className="chip border-crit/40 text-crit">↻ reopened ×{ticket.reopenCount}</span>}</div>
            <h1 className="text-xl font-bold leading-tight">{ticket.title}</h1>
            <p className="max-w-3xl text-sm text-mute">{ticket.description}</p>
            <p className="text-xs text-mute">{ticket.categoryName} · {ticket.customer.name} · {ticket.customer.phone} · {ticket.customer.address} · plan <b className="text-ink">{ticket.customer.planMbps} Mbps</b></p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center"><SlaRing state={ticket.slaState} startedAt={ticket.slaStartedAt} deadline={ticket.slaDeadline} closed={ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'} size={64} /><p className="mt-1 text-[10px] uppercase text-mute">SLA</p></div>
            <div className="text-center"><ProgressRing value={job ? job.progress : ticket.progress} size={64} stroke={6} color={job ? 'rgb(var(--info))' : 'rgb(var(--brand))'} /><p className="mt-1 text-[10px] uppercase text-mute">{job ? 'job' : 'progress'}</p></div>
          </div>
        </div>

        {ticket.status !== 'CANCELLED' ? <Stepper status={ticket.status} /> : <p className="rounded-lg border border-line p-2 text-sm text-mute">Cancelled: {ticket.cancelReason}</p>}
        {job && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 rounded-lg border border-info/40 bg-info/5 p-3 text-sm"><span className="h-2 w-2 animate-pulse rounded-full bg-info" /><span className="font-medium">{job.type === 'DIAGNOSE_LINE' ? 'Automatic line diagnostics' : 'Automatic speed verification'}</span><span className="text-mute">{job.stage}</span><span className="mono ml-auto text-info">{job.progress}%</span></motion.div>}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {manager && (ticket.status === 'AWAITING_ASSIGNMENT' || ticket.status === 'REOPENED') && <button className="btn-primary" onClick={() => setAssign(true)}><UserPlus className="h-4 w-4" />Assign technician</button>}
          {manager && (ticket.status === 'ASSIGNED' || ticket.status === 'IN_PROGRESS') && <button className="btn-ghost" onClick={() => setAssign(true)}><UserPlus className="h-4 w-4" />Reassign</button>}
          {mineOrManager && ticket.status === 'IN_PROGRESS' && allDone && (
            <span className="flex items-center gap-1">
              <button className="btn-primary" disabled={busy === 'verify'} onClick={() => run('verify', () => post(`/tickets/${id}/request-verification`, simulate ? { simulate } : {}))}><Gauge className="h-4 w-4" />Request speed verification</button>
              {cfg?.demoMode && <select className="input !w-auto !py-1.5 text-xs" value={simulate} onChange={(e) => setSimulate(e.target.value as never)} aria-label="Simulated verification outcome"><option value="">random</option><option value="PASS">force PASS</option><option value="FAIL">force FAIL</option></select>}
            </span>
          )}
          {staff && ticket.status === 'RESOLVED' && <><button className="btn-primary !bg-ok" disabled={busy === 'confirm'} onClick={() => run('confirm', () => post(`/tickets/${id}/confirm`, {}))}><CheckCheck className="h-4 w-4" />Customer confirmed</button><button className="btn-danger" onClick={() => setDialog('reopen')}><RotateCcw className="h-4 w-4" />Still broken</button></>}
          {staff && ticket.status === 'CLOSED' && <button className="btn-ghost" onClick={() => setDialog('reopen')}><RotateCcw className="h-4 w-4" />Reopen</button>}
          {manager && !terminal && ticket.status !== 'RESOLVED' && <button className="btn-ghost" onClick={() => { setEditStep(null); setDialog('step'); }}><Plus className="h-4 w-4" />Add step</button>}
          {staff && !terminal && ticket.status !== 'RESOLVED' && <button className="btn-ghost" onClick={() => setDialog('edit')}><Pencil className="h-4 w-4" />Edit</button>}
          {staff && !terminal && <button className="btn-danger ml-auto" onClick={() => setDialog('cancel')}><Ban className="h-4 w-4" />Cancel</button>}
          {trackUrl && <button className="btn-ghost" onClick={() => { void navigator.clipboard?.writeText(trackUrl); useUi.getState().toast({ kind: 'ok', title: 'Customer tracking link copied', text: trackUrl }); }}><Copy className="h-4 w-4" />Tracking link</button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold"><FastForward className="h-4 w-4 text-brand" />Work plan · estimated vs actual</h2>
            <div className="flex gap-3 text-xs"><span className="text-mute">Estimated <b className="mono text-ink">{fmtMinutes(ticket.estimatedTotalMin)}</b></span><span className="text-mute">Actual <b className={clsx('mono', ticket.actualTotalMin > ticket.estimatedTotalMin ? 'text-warn' : 'text-ok')}>{fmtMinutes(ticket.actualTotalMin)}</b></span>{ticket.forecastFinish && <span className="text-mute">Forecast <b className="mono text-ink">{new Date(ticket.forecastFinish).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span>}</div>
          </div>
          {steps.length ? <StepGantt steps={steps} actions={stepActions} /> : <p className="py-8 text-center text-sm text-mute">{ticket.status === 'OPEN' || ticket.status === 'DIAGNOSING' ? 'The work plan is generated automatically when diagnostics finish…' : 'No steps yet.'}</p>}
          <p className="text-[11px] text-mute">Dashed outline = estimate · green = actual within estimate · <span className="hatch rounded bg-danger px-1">hatched red</span> = time over estimate. A step never starts because a clock ran out, only when the steps it depends on are finished.</p>
        </section>
        <section className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">Owner</h2>
            {ticket.technician ? <div className="flex items-center gap-2"><Avatar name={ticket.technician.name} size={36} /><div><p className="text-sm font-semibold">{ticket.technician.name}</p><p className="text-xs text-mute">{ticket.technician.skills.join(' · ')}</p></div></div> : <p className="text-sm text-mute">Not assigned yet</p>}
            {detail && detail.assignments.length > 0 && <ul className="mt-3 space-y-1 border-t border-line pt-2 text-[11px] text-mute">{detail.assignments.slice(0, 4).map((a) => <li key={a.id}>{a.role.toLowerCase()} · {a.technicianName}{a.releasedAt ? ' (released)' : ''}</li>)}</ul>}
          </div>
          <div className="card p-4"><h2 className="mb-3 font-semibold">Audit timeline</h2>{timeline.length ? <Timeline items={timeline} /> : <div className="skeleton h-24" />}</div>
        </section>
      </div>

      <AssignDialog ticket={assign ? ticket : null} onClose={() => setAssign(false)} />
      <ReasonDialog open={dialog === 'cancel'} title={`Cancel ${ticket.ticketNo}`} label="Why is this ticket being cancelled?" confirm="Cancel ticket" danger onClose={() => setDialog(null)} onSubmit={async (reason) => { await post(`/tickets/${id}/cancel`, { reason }); }} />
      <ReasonDialog open={dialog === 'reopen'} title={`Reopen ${ticket.ticketNo}`} label="What is still wrong?" confirm="Reopen" onClose={() => setDialog(null)} onSubmit={async (reason) => { await post(`/tickets/${id}/reopen`, { reason }); }} />
      <EditDialog open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <StepDialog open={dialog === 'step'} steps={steps} ticketId={id} editing={editStep} onClose={() => { setDialog(null); setEditStep(null); }} />
    </div>
  );
}

function EditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { id = '' } = useParams();
  const t = useData((s) => s.tickets[id]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [version, setVersion] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open && t) { setTitle(t.title); setDescription(t.description); setPriority(t.priority); setVersion(t.version); setErr(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const save = async () => {
    if (title.trim().length < 5 || description.trim().length < 10) { setErr('Title needs 5+ characters and details 10+ characters.'); return; }
    try { await patch(`/tickets/${id}`, { title: title.trim(), description: description.trim(), priority, version }); onClose(); }
    catch (e) { setErr(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'Someone else updated this ticket while you were editing. Close this dialog, review the latest version and try again.' : e instanceof Error ? e.message : 'Failed'); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit ticket">
      <div className="space-y-3">
        {err && <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{err}</p>}
        <div><label className="label">Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label className="label">Details</label><textarea className="input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><label className="label">Priority (changes the SLA deadline)</label><div className="flex gap-1">{ALL_PRIORITIES.map((p) => <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)} className={clsx('flex-1 rounded-lg border px-2 py-1.5 text-xs', priority === p ? `${PRIORITY_META[p].cls} ring-2 ring-brand/50` : 'border-line text-mute')}>{PRIORITY_META[p].label}</button>)}</div></div>
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save changes</button></div>
      </div>
    </Modal>
  );
}
