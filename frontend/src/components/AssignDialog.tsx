import { Loader2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ApiError, get, post } from '../api/client';
import type { Suggestion, Ticket } from '../api/types';
import { Modal } from './Modal';
import { Avatar } from './Badges';
import { LoadMeter } from './TechnicianCard';
import { useUi } from '../store/ui';
import { useData } from '../store/data';

/** Ranked technician suggestions (skill fit + free capacity). Races are handled by the server: 409 -> friendly message. */
export function AssignDialog({ ticket, onClose }: { ticket: Ticket | null; onClose: () => void }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // always assign against the freshest version we know about (live-updated by WebSocket)
  const live = useData((s) => (ticket ? s.tickets[ticket.id] : undefined)) ?? ticket;

  const load = () => { if (ticket) get<{ items: Suggestion[] }>(`/tickets/${ticket.id}/suggestions`).then((r) => setItems(r.items)).catch(() => setItems([])); };
  useEffect(() => { setItems(null); setError(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticket?.id]);

  const assign = async (s: Suggestion) => {
    if (!live) return;
    setBusyId(s.technician.id); setError(null);
    try {
      await post(`/tickets/${live.id}/assign`, { technicianId: s.technician.id, version: live.version });
      useUi.getState().toast({ kind: 'ok', title: `${live.ticketNo} assigned to ${s.technician.name}` });
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Could not assign.';
      setError(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'Someone else just changed this ticket. The list was refreshed; please check and try again.' : msg);
      load();
    } finally { setBusyId(null); }
  };

  return (
    <Modal open={!!ticket} onClose={onClose} title={ticket ? `Assign ${ticket.ticketNo}` : 'Assign'}>
      {ticket && <p className="mb-3 text-sm text-mute">{ticket.title}{ticket.diagnosis && <> · diagnosis <b className="text-ink">{ticket.diagnosis.replace('_', ' ')}</b></>}</p>}
      {error && <p role="alert" className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{error}</p>}
      {!items ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((s, i) => (
            <li key={s.technician.id} className={clsx('flex items-center gap-3 rounded-lg border p-3', i === 0 && s.canAssign ? 'border-brand/60 bg-brand/5' : 'border-line')}>
              <Avatar name={s.technician.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold">{s.technician.name}{i === 0 && s.canAssign && <span className="chip border-brand/40 text-brand"><Sparkles className="h-3 w-3" />Best match</span>}</p>
                <p className="truncate text-[11px] text-mute">{s.reasons.join(' · ')}</p>
                <div className="mt-1"><LoadMeter active={s.technician.activeTickets} max={s.technician.maxActive} /></div>
              </div>
              <button className="btn-primary" disabled={!s.canAssign || busyId !== null} onClick={() => assign(s)}>
                {busyId === s.technician.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assign'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
