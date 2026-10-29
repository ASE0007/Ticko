import { useState } from 'react';
import { DateNav, DayReport } from '../components/DayReport';
import { toLocalDateInput } from '../lib/format';
import { useAuth } from '../store/auth';

/** Technician's own day: every task they did, with start/finish times and estimate vs actual. */
export default function MyDay() {
  const me = useAuth((s) => s.user)!;
  const [date, setDate] = useState(toLocalDateInput(new Date()));
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-bold">My day</h1><p className="text-sm text-mute">What I worked on, when, and how long it really took.</p></div><DateNav date={date} onChange={setDate} /></div>
      {me.technicianId ? <DayReport technicianId={me.technicianId} date={date} /> : <p className="text-sm text-mute">This account is not linked to a technician profile.</p>}
    </div>
  );
}
