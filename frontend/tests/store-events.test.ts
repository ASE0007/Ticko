import { beforeEach, describe, expect, it } from 'vitest';
import { applyEvent } from '../src/ws/events';
import { useData } from '../src/store/data';
import { useUi } from '../src/store/ui';
import { useAuth } from '../src/store/auth';
import { step, ticket } from './fixtures';

const msg = (type: string, payload: unknown, seq = 1) => ({ seq, type, ts: new Date().toISOString(), payload });

beforeEach(() => {
  useData.getState().reset();
  useUi.setState({ toasts: [] });
  useAuth.setState({ token: 't', user: { id: 'u', name: 'Sup S', role: 'SUPERVISOR', technicianId: null } });
});

describe('server events -> state (real-time store)', () => {
  it('ticket.created adds the ticket, logs activity and toasts staff', () => {
    const t = ticket();
    applyEvent(msg('ticket.created', { ticket: t }));
    expect(useData.getState().tickets[t.id]).toBeDefined();
    expect(useData.getState().activity[0]?.text).toContain(t.ticketNo);
    expect(useUi.getState().toasts[0]?.title).toContain('New ticket');
  });

  it('never lets an older version overwrite a newer one (out-of-order delivery)', () => {
    const t = ticket({ version: 5, status: 'IN_PROGRESS' });
    applyEvent(msg('ticket.updated', { ticket: t }));
    applyEvent(msg('ticket.updated', { ticket: { ...t, version: 4, status: 'ASSIGNED' } }));
    expect(useData.getState().tickets[t.id]?.status).toBe('IN_PROGRESS');
    applyEvent(msg('ticket.updated', { ticket: { ...t, version: 6, status: 'VERIFYING' } }));
    expect(useData.getState().tickets[t.id]?.status).toBe('VERIFYING');
  });

  it('job.progress moves the ticket progress bar live', () => {
    const t = ticket({ status: 'DIAGNOSING', progress: 0 });
    applyEvent(msg('ticket.created', { ticket: t }));
    applyEvent(msg('job.progress', { jobId: 'j1', ticketId: t.id, type: 'DIAGNOSE_LINE', progress: 60, stage: 'Testing packet loss', ticketProgress: 9 }));
    expect(useData.getState().jobs['j1']).toMatchObject({ progress: 60, stage: 'Testing packet loss', status: 'RUNNING' });
    expect(useData.getState().tickets[t.id]?.progress).toBe(9);
  });

  it('step.updated stores the plan; step.overrun raises a warning toast', () => {
    const t = ticket();
    applyEvent(msg('step.updated', { ticketId: t.id, steps: [step({ ticketId: t.id })], forecast: { finish: null, estimatedTotalMin: 20, actualTotalMin: 0 } }));
    expect(useData.getState().steps[t.id]).toHaveLength(1);
    applyEvent(msg('step.overrun', { ticketId: t.id, ticketNo: 'TX-1', stepId: 's', title: 'Check router', level: 3, multiple: 2, estimatedMinutes: 20, elapsedMinutes: 41, suggestion: 'Consider adding a helper or reassigning' }));
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'danger' });
    expect(useData.getState().activity[0]?.text).toContain('2×');
  });

  it('SLA breach and failed verification surface to supervisors', () => {
    const t = ticket({ ticketNo: 'TX-77' });
    applyEvent(msg('sla.breached', { ticketId: t.id, ticketNo: 'TX-77' }));
    expect(useUi.getState().toasts.at(-1)?.title).toContain('SLA BREACHED');
    applyEvent(msg('ticket.status_changed', { ticket: t, from: 'VERIFYING', to: 'IN_PROGRESS', verification: { passed: false, measuredMbps: 12, planMbps: 50 } }));
    expect(useUi.getState().toasts.at(-1)?.title).toContain('failed verification');
  });

  it('technicians only get toasts for their own assignments', () => {
    useAuth.setState({ user: { id: 'u2', name: 'Nusrat', role: 'TECHNICIAN', technicianId: 'tech-1' } });
    const mine = ticket({ technician: { id: 'tech-1', name: 'Nusrat', skills: [] } });
    const other = ticket({ technician: { id: 'tech-2', name: 'Rafi', skills: [] } });
    applyEvent(msg('ticket.created', { ticket: other }));
    expect(useUi.getState().toasts).toHaveLength(0);
    applyEvent(msg('ticket.assigned', { ticket: mine }));
    expect(useUi.getState().toasts[0]?.title).toContain('New assignment');
  });

  it('technician.updated / metrics.updated / presence.updated feed the dashboard', () => {
    applyEvent(msg('technician.updated', { technician: { id: 'x', name: 'Rafi', activeTickets: 2, maxActive: 2, atCapacity: true, skills: [], availability: 'AVAILABLE', userId: 'u', email: 'e' } }));
    expect(useData.getState().technicians['x']?.atCapacity).toBe(true);
    applyEvent(msg('presence.updated', { online: [{ id: '1', name: 'Sup', role: 'SUPERVISOR' }] }));
    expect(useData.getState().online).toHaveLength(1);
  });
});
