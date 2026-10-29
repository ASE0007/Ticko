import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { useAuth } from '../src/store/auth';
import { useData } from '../src/store/data';
import { useUi } from '../src/store/ui';
import { step, ticket } from './fixtures';

class QuietWS { static OPEN = 1; readyState = 0; onopen = null; onmessage = null; onclose = null; onerror = null; constructor(public url: string) {} send() {} close() {} }

const t1 = ticket({ title: 'Router keeps rebooting', status: 'AWAITING_ASSIGNMENT', priority: 'HIGH', diagnosis: 'ROUTER_CONFIG' });
const t2 = ticket({ title: 'No internet since morning', status: 'IN_PROGRESS', progress: 45, technician: { id: 'tech-1', name: 'Nusrat Jahan', skills: ['ROUTER'] }, estimatedTotalMin: 30, actualTotalMin: 60, slaState: 'WARNING' });
const steps2 = [
  step({ id: 'a', ticketId: t2.id, seq: 1, title: 'Check router & connection', status: 'IN_PROGRESS', startedAt: new Date(Date.now() - 50 * 60_000).toISOString(), overrun: true, overrunLevel: 3, assigneeId: 'tech-1', assigneeName: 'Nusrat Jahan' }),
  step({ id: 'b', ticketId: t2.id, seq: 2, title: 'Run speed test', status: 'LOCKED', dependsOn: ['a'], estimatedMinutes: 5 }),
];
const tech = { id: 'tech-1', userId: 'u1', name: 'Nusrat Jahan', email: 'n@x', skills: ['ROUTER'], availability: 'AVAILABLE', activeTickets: 1, maxActive: 2, atCapacity: false, currentTickets: [] };
const metrics = {
  tickets: { open: 2, createdLast24h: 3, resolvedLast24h: 1, byStatus: {}, unassigned: 1 }, sla: { onTrack: 1, atRisk: 0, warning: 1, breached: 0 },
  queue: { queued: 0, running: 0, concurrency: 3, utilisation: 0, jobsPerMin: 2, succeeded: 5, failed: 0, cancelled: 0, retried: 0 },
  technicians: { count: 4, activeTickets: 1, capacity: 8, utilisationPct: 13 }, realtime: { clients: 2 }, config: { timeScale: 60, demoMode: true, maxActiveTickets: 2 },
};

function mockApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).replace('/api', '');
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (path.startsWith('/config')) return json({ timeScale: 60, demoMode: true, maxActiveTickets: 2, verifyPassThreshold: 0.8, autoCloseHours: 48 });
    if (path.startsWith('/metrics')) return json(metrics);
    if (path.startsWith('/categories')) return json({ items: [{ code: 'SLOW_SPEED', name: 'Slow speed', description: null, planTemplate: 'UNKNOWN', defaultPriority: 'MEDIUM', active: true, builtin: true, sortOrder: 1, ticketCount: 2 }] });
    if (path.startsWith('/reports/throughput')) return json({ buckets: [{ hour: new Date().toISOString(), created: 2, resolved: 1 }] });
    if (path.startsWith('/technicians')) return json({ items: [tech] });
    if (path.startsWith('/jobs')) return json({ items: [], stats: {} });
    if (path.match(/\/tickets\/[^/]+\/timeline/)) return json({ items: [{ id: '1', entity: 'TICKET', from: null, to: 'OPEN', message: 'Ticket created', actor: 'Operator Mim', actorRole: 'OPERATOR', createdAt: new Date().toISOString() }] });
    if (path.match(/\/tickets\/[^/?]+\/steps/)) return json({ steps: steps2, forecast: { finish: null, estimatedTotalMin: 30, actualTotalMin: 60 } });
    if (path.match(/\/tickets\/[^/?]+$/)) return json({ ticket: t2, steps: steps2, forecast: { finish: null, estimatedTotalMin: 30, actualTotalMin: 60 }, jobs: [], assignments: [], trackToken: 'tok' });
    if (path.startsWith('/tickets')) return json({ items: [t1, t2], page: 1, limit: 15, total: 2, totalPages: 1 });
    if (path.startsWith('/customers')) return json({ items: [] });
    return new Response('{}', { status: 200 });
  }));
}

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => {
  useData.getState().reset();
  useUi.setState({ toasts: [], timeScale: 60, newTicketOpen: false });
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietWS;
  mockApi();
});

describe('page smoke tests (render with API data, no crashes)', () => {
  it('redirects anonymous users to login', async () => {
    useAuth.setState({ token: null, user: null });
    open('/');
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('Command Center: KPIs, Kanban columns, worker pool, technicians', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Super S', role: 'SUPERVISOR', technicianId: null } });
    open('/');
    expect((await screen.findAllByText('Router keeps rebooting')).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Needs assignment' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'In the field' })).getByText('No internet since morning')).toBeInTheDocument();
    expect(screen.getByTestId('worker-pool')).toBeInTheDocument();
    expect(screen.getByText('Open tickets')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /assign/i }).length).toBeGreaterThan(0); // supervisor can assign t1
    // new structured sections: live field team + needs-attention queue + throughput
    expect(screen.getByRole('region', { name: 'Field team' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Field team' })).getByText('Nusrat Jahan')).toBeInTheDocument();
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByText(/Waiting for a technician/)).toBeInTheDocument(); // t1 is unassigned
    expect(within(attention).getByText(/SLA warning/)).toBeInTheDocument(); // t2 is in WARNING
    expect(screen.getByRole('region', { name: 'Throughput' })).toBeInTheDocument();
  });

  it('Tickets list: table rows, filters, search box', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Op', role: 'OPERATOR', technicianId: null } });
    open('/tickets');
    await waitFor(() => expect(screen.getAllByText('Router keeps rebooting').length).toBeGreaterThan(0));
    expect(screen.getByLabelText('Search tickets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Critical' })).toBeInTheDocument();
    expect(screen.getByText(/2 tickets · page 1\/1/)).toBeInTheDocument();
  });

  it('Ticket detail: lifecycle, estimated vs actual, overrun flag, locked step reason, actions', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Super S', role: 'SUPERVISOR', technicianId: null } });
    open(`/tickets/${t2.id}`);
    expect(await screen.findByText('No internet since morning')).toBeInTheDocument();
    expect(await screen.findByText(/Work plan · estimated vs actual/)).toBeInTheDocument();
    expect(screen.getByText(/OVERRUN 2×/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for step #1 to finish/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reassign/i })).toBeInTheDocument();
    expect(await screen.findByText(/created this ticket/)).toBeInTheDocument(); // audit timeline (plain sentence)
  });

  it('Technician lands on My work and only sees own tickets', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Nusrat Jahan', role: 'TECHNICIAN', technicianId: 'tech-1' } });
    open('/');
    expect(await screen.findByRole('heading', { name: 'My work' })).toBeInTheDocument();
    expect(await screen.findByText('No internet since morning')).toBeInTheDocument();
    expect(screen.queryByText('Router keeps rebooting')).toBeNull();
    expect(screen.queryByRole('button', { name: /new ticket/i })).toBeNull(); // technicians cannot file tickets
  });

  it('role guard: operators cannot open the Jobs page', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Op', role: 'OPERATOR', technicianId: null } });
    open('/jobs');
    await waitFor(() => expect(screen.queryByText('Background jobs')).toBeNull());
    expect(await screen.findByText('Open tickets')).toBeInTheDocument(); // bounced to the dashboard
  });
});

describe('role based navigation for the new admin / report pages', () => {
  it('admin sees Users and Settings; supervisor sees Settings but not Users; technician sees My day', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Admin A', role: 'ADMIN', technicianId: null } });
    const a = open('/');
    expect((await screen.findAllByText('Users')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Day reports').length).toBeGreaterThan(0);
    a.unmount();
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Super S', role: 'SUPERVISOR', technicianId: null } });
    const b = open('/');
    expect((await screen.findAllByText('Settings')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Users')).toBeNull();
    b.unmount();
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Nusrat Jahan', role: 'TECHNICIAN', technicianId: 'tech-1' } });
    open('/');
    expect((await screen.findAllByText('My day')).length).toBeGreaterThan(0);
  });

  it('operators are bounced from admin pages', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Op', role: 'OPERATOR', technicianId: null } });
    open('/admin/users');
    expect(await screen.findByText('Open tickets')).toBeInTheDocument();
    expect(screen.queryByText('Users & access')).toBeNull();
  });
});
