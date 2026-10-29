import { useEffect, useMemo } from 'react';
import { get, patch } from '../api/client';
import type { Availability, Technician } from '../api/types';
import { useData } from '../store/data';
import { useAuth, isManager } from '../store/auth';
import { useUi } from '../store/ui';
import { TechnicianCard } from '../components/TechnicianCard';

export default function Technicians() {
  const techMap = useData((s) => s.technicians);
  const techs = useMemo(() => Object.values(techMap), [techMap]);
  const tickets = useData((s) => s.tickets);
  const manager = isManager(useAuth((s) => s.user));
  const online = useData((s) => s.online);

  useEffect(() => { get<{ items: Technician[] }>('/technicians').then((r) => useData.getState().setTechnicians(r.items)).catch(() => undefined); }, [tickets]);

  const setAv = (id: string, availability: Availability) =>
    patch(`/technicians/${id}/availability`, { availability }).catch((e) => useUi.getState().toast({ kind: 'danger', title: e.message }));

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Technician workload</h1><p className="text-sm text-mute">Each technician can hold a limited number of active tickets. Bars update live as work is assigned and finished.</p></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {techs.map((t) => (
          <div key={t.id} className="space-y-2">
            <TechnicianCard tech={t} />
            {manager && (
              <select className="input text-xs" value={t.availability} onChange={(e) => void setAv(t.id, e.target.value as Availability)} aria-label={`Availability of ${t.name}`}>
                <option value="AVAILABLE">Available</option><option value="BUSY">Busy</option><option value="OFF_DUTY">Off duty (cannot be assigned)</option>
              </select>
            )}
          </div>
        ))}
      </div>
      {online.length > 0 && <div className="card p-3 text-xs text-mute">Online now: {online.map((o) => o.name).join(', ')}</div>}
    </div>
  );
}
