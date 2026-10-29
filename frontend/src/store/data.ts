import { create } from 'zustand';
import type { CategoryInfo, Forecast, Metrics, Step, Technician, Ticket } from '../api/types';

export interface LiveJob { jobId: string; ticketId: string | null; type: string; status: string; progress: number; stage: string | null; priorityRank?: number }
export interface Activity { id: number; ts: string; kind: 'info' | 'ok' | 'warn' | 'danger'; text: string; ticketId?: string | undefined }

interface DataState {
  tickets: Record<string, Ticket>;
  steps: Record<string, Step[]>;
  forecasts: Record<string, Forecast>;
  technicians: Record<string, Technician>;
  categories: CategoryInfo[];
  jobs: Record<string, LiveJob>;
  metrics: Metrics | null;
  online: { id: string; name: string; role: string }[];
  activity: Activity[];
  loaded: boolean;
  upsertTicket: (t: Ticket) => void;
  setTickets: (list: Ticket[]) => void;
  setSteps: (ticketId: string, steps: Step[], forecast?: Forecast) => void;
  upsertTechnician: (t: Technician) => void;
  setTechnicians: (list: Technician[]) => void;
  setCategories: (list: CategoryInfo[]) => void;
  upsertJob: (j: LiveJob) => void;
  setJobs: (list: LiveJob[]) => void;
  setMetrics: (m: Metrics) => void;
  setOnline: (o: DataState['online']) => void;
  log: (a: Omit<Activity, 'id' | 'ts'>) => void;
  setLoaded: (b: boolean) => void;
  reset: () => void;
}

let actId = 1;

/** Newer wins: higher version, or same version with a later updatedAt (derived-field refresh). */
function isNewer(incoming: Ticket, existing?: Ticket): boolean {
  if (!existing) return true;
  if (incoming.version !== existing.version) return incoming.version > existing.version;
  return incoming.updatedAt >= existing.updatedAt;
}

const empty = { tickets: {}, steps: {}, forecasts: {}, technicians: {}, categories: [] as CategoryInfo[], jobs: {}, metrics: null, online: [], activity: [], loaded: false };

export const useData = create<DataState>((set) => ({
  ...empty,
  upsertTicket: (t) => set((s) => (isNewer(t, s.tickets[t.id]) ? { tickets: { ...s.tickets, [t.id]: t } } : s)),
  setTickets: (list) =>
    set((s) => {
      const next = { ...s.tickets };
      for (const t of list) if (isNewer(t, next[t.id])) next[t.id] = t;
      return { tickets: next };
    }),
  setSteps: (ticketId, steps, forecast) =>
    set((s) => ({ steps: { ...s.steps, [ticketId]: steps }, forecasts: forecast ? { ...s.forecasts, [ticketId]: forecast } : s.forecasts })),
  upsertTechnician: (t) => set((s) => ({ technicians: { ...s.technicians, [t.id]: { ...s.technicians[t.id], ...t } } })),
  setTechnicians: (list) => set({ technicians: Object.fromEntries(list.map((t) => [t.id, t])) }),
  setCategories: (categories) => set({ categories }),
  upsertJob: (j) => set((s) => ({ jobs: { ...s.jobs, [j.jobId]: { ...s.jobs[j.jobId], ...j } } })),
  setJobs: (list) => set((s) => ({ jobs: { ...s.jobs, ...Object.fromEntries(list.map((j) => [j.jobId, j])) } })),
  setMetrics: (metrics) => set({ metrics }),
  setOnline: (online) => set({ online }),
  log: (a) => set((s) => ({ activity: [{ ...a, id: actId++, ts: new Date().toISOString() }, ...s.activity].slice(0, 60) })),
  setLoaded: (loaded) => set({ loaded }),
  reset: () => set({ ...empty }),
}));

/** Active (queued/running) background job for a ticket, if any. */
export function activeJobFor(jobs: Record<string, LiveJob>, ticketId: string): LiveJob | undefined {
  return Object.values(jobs).find((j) => j.ticketId === ticketId && (j.status === 'RUNNING' || j.status === 'QUEUED'));
}
