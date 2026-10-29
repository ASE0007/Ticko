/**
 * Contract test: tests/real-events.json holds events captured from a REAL backend run
 * (live WebSocket session during the demo traffic simulation). Replaying them through the
 * client proves the payload shapes the server sends are exactly what the UI expects.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import real from './real-events.json';
import { applyEvent } from '../src/ws/events';
import { useData } from '../src/store/data';
import { useUi } from '../src/store/ui';
import { useAuth } from '../src/store/auth';
import type { WsMessage } from '../src/api/types';

const events = real as unknown as Record<string, WsMessage>;

beforeEach(() => {
  useData.getState().reset();
  useUi.setState({ toasts: [] });
  useAuth.setState({ token: 't', user: { id: 'u', name: 'Supervisor', role: 'SUPERVISOR', technicianId: null } });
});

describe('real server events drive the client stores', () => {
  it('captured a rich set of event types', () => {
    for (const t of ['ticket.created', 'job.progress', 'step.updated', 'step.overrun', 'sla.warning', 'ticket.assigned', 'technician.updated', 'metrics.updated']) {
      expect(events[t], `missing ${t}`).toBeDefined();
    }
  });

  it('every captured event applies without throwing', () => {
    for (const m of Object.values(events)) expect(() => applyEvent(m)).not.toThrow();
  });

  it('ticket events carry the full DTO the UI renders (slaStartedAt, customer, version…)', () => {
    const t = events['ticket.created']!.payload.ticket;
    for (const k of ['id', 'ticketNo', 'status', 'priority', 'slaState', 'slaStartedAt', 'slaDeadline', 'version', 'progress', 'customer']) expect(t, k).toHaveProperty(k);
    applyEvent(events['ticket.created']!);
    expect(useData.getState().tickets[t.id]?.ticketNo).toBe(t.ticketNo);
  });

  it('step.updated payload replaces the plan with overrun/eta fields for the Gantt', () => {
    const p = events['step.updated']!.payload;
    applyEvent(events['step.updated']!);
    const steps = useData.getState().steps[p.ticketId]!;
    expect(steps.length).toBeGreaterThan(0);
    for (const k of ['id', 'seq', 'status', 'estimatedMinutes', 'dependsOn', 'overrunLevel', 'etaMinutes']) expect(steps[0], k).toHaveProperty(k);
  });

  it('step.overrun and sla.* events produce supervisor-facing toasts and activity', () => {
    applyEvent(events['step.overrun']!);
    applyEvent(events['sla.warning']!);
    applyEvent(events['sla.breached']!);
    const titles = useUi.getState().toasts.map((t) => t.title).join(' | ');
    expect(titles).toMatch(/overrun/i);
    expect(titles).toMatch(/SLA/);
    expect(useData.getState().activity.length).toBeGreaterThanOrEqual(3);
  });

  it('verification result rides on ticket.status_changed', () => {
    const m = events['ticket.status_changed:verification'];
    if (!m) return; // random run may not have produced one
    expect(m.payload.verification).toHaveProperty('passed');
    expect(m.payload.verification).toHaveProperty('measuredMbps');
  });

  it('metrics.updated payload matches the dashboard KPI shape', () => {
    applyEvent(events['metrics.updated']!);
    const m = useData.getState().metrics!;
    expect(m.queue).toHaveProperty('concurrency');
    expect(m.technicians).toHaveProperty('utilisationPct');
    expect(m.sla).toHaveProperty('breached');
  });
});
