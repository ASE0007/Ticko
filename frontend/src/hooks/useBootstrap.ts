import { useEffect } from 'react';
import { get } from '../api/client';
import type { AppConfig, CategoryInfo, Job, Metrics, Page, Step, Technician, Ticket } from '../api/types';
import { useAuth, isManager } from '../store/auth';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { RealtimeClient } from '../ws/socket';
import { OPEN_STATUSES } from '../lib/format';

/** Initial / resync load over REST. After this, WebSocket events keep everything fresh (no polling). */
export async function bootstrap(): Promise<void> {
  const { user } = useAuth.getState();
  const data = useData.getState();
  const manager = isManager(user);
  const [cfg, tickets, techs, metrics, cats] = await Promise.all([
    get<AppConfig>('/config'),
    get<Page<Ticket>>(`/tickets?status=${OPEN_STATUSES.join(',')}&limit=100&sort=updatedAt&order=desc`),
    get<{ items: Technician[] }>('/technicians'),
    get<Metrics>('/metrics'),
    get<{ items: CategoryInfo[] }>(`/categories${manager ? '?all=true' : ''}`),
  ]);
  useUi.getState().setTimeScale(cfg.timeScale);
  data.setTickets(tickets.items);
  data.setTechnicians(techs.items);
  data.setMetrics(metrics);
  data.setCategories(cats.items);
  if (user && user.role !== 'TECHNICIAN') {
    // steps of tickets in the field power the live "Field team" cards
    const active = tickets.items.filter((t) => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS').slice(0, 25);
    await Promise.allSettled(active.map((t) => get<{ steps: Step[] }>(`/tickets/${t.id}/steps`).then((r) => useData.getState().setSteps(t.id, r.steps))));
  }
  if (manager) {
    const jobs = await get<{ items: Job[] }>('/jobs?status=QUEUED,RUNNING&limit=50');
    data.setJobs(jobs.items.map((j) => ({ jobId: j.id, ticketId: j.ticketId, type: j.type, status: j.status, progress: j.progress, stage: j.stage, priorityRank: j.priorityRank })));
  }
  data.setLoaded(true);
}

/** Opens the authenticated WebSocket for the lifetime of the app shell. */
export function useRealtime(): void {
  const token = useAuth((s) => s.token);
  useEffect(() => {
    if (!token) return;
    let client: RealtimeClient | null = null;
    let cancelled = false;
    bootstrap()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        client = new RealtimeClient({ token }, { onResync: () => void bootstrap().catch(() => undefined) });
        client.connect();
      });
    return () => {
      cancelled = true;
      client?.close();
      useData.getState().reset();
    };
  }, [token]);
}
