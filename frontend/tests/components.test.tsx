import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanbanBoard } from '../src/components/KanbanBoard';
import { StepGantt } from '../src/components/StepGantt';
import { LoadMeter } from '../src/components/TechnicianCard';
import { NewTicketDrawer } from '../src/components/NewTicketDrawer';
import Login from '../src/pages/Login';
import { useAuth } from '../src/store/auth';
import { useData } from '../src/store/data';
import { useUi } from '../src/store/ui';
import { step, ticket } from './fixtures';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  useData.getState().reset();
  useUi.setState({ toasts: [], newTicketOpen: false, timeScale: 1 });
  useAuth.setState({ token: null, user: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
});

describe('KanbanBoard', () => {
  it('groups tickets by status into columns and updates when a ticket moves', () => {
    const a = ticket({ status: 'DIAGNOSING', title: 'Alpha outage' });
    const b = ticket({ status: 'AWAITING_ASSIGNMENT', title: 'Bravo outage' });
    const { rerender } = wrap(<KanbanBoard tickets={[a, b]} onAssign={() => undefined} />);
    const intake = screen.getByRole('region', { name: 'Intake & diagnostics' });
    const assign = screen.getByRole('region', { name: 'Needs assignment' });
    expect(within(intake).getByText('Alpha outage')).toBeInTheDocument();
    expect(within(assign).getByText('Bravo outage')).toBeInTheDocument();

    // server event: Alpha finished diagnostics -> it appears in the next column
    rerender(<MemoryRouter><KanbanBoard tickets={[{ ...a, status: 'AWAITING_ASSIGNMENT', version: 2 }, b]} onAssign={() => undefined} /></MemoryRouter>);
    expect(within(screen.getByRole('region', { name: 'Needs assignment' })).getByText('Alpha outage')).toBeInTheDocument();
  });

  it('shows an Assign button only to managers, for tickets without an owner', () => {
    const t = ticket({ status: 'AWAITING_ASSIGNMENT' });
    useAuth.setState({ user: { id: 'u', name: 'Op', role: 'OPERATOR', technicianId: null } });
    const { unmount } = wrap(<KanbanBoard tickets={[t]} onAssign={() => undefined} />);
    expect(screen.queryByRole('button', { name: /assign/i })).toBeNull();
    unmount();
    useAuth.setState({ user: { id: 'u', name: 'Sup', role: 'SUPERVISOR', technicianId: null } });
    const onAssign = vi.fn();
    wrap(<KanbanBoard tickets={[t]} onAssign={onAssign} />);
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));
    expect(onAssign).toHaveBeenCalledWith(t);
  });

  it('shows live job progress on the card while diagnostics run', () => {
    const t = ticket({ status: 'DIAGNOSING', progress: 6 });
    useData.getState().upsertJob({ jobId: 'j', ticketId: t.id, type: 'DIAGNOSE_LINE', status: 'RUNNING', progress: 40, stage: 'Measuring optical signal' });
    wrap(<KanbanBoard tickets={[t]} onAssign={() => undefined} />);
    expect(screen.getByText('Measuring optical signal')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });
});

describe('StepGantt: estimate vs actual, dependencies', () => {
  it('flags an overrunning step and explains why the next step is waiting', () => {
    const s1 = step({ id: 'a', seq: 1, status: 'IN_PROGRESS', startedAt: new Date(Date.now() - 50 * 60_000).toISOString(), overrun: true, overrunLevel: 3, title: 'Check router' });
    const s2 = step({ id: 'b', seq: 2, status: 'LOCKED', dependsOn: ['a'], estimatedMinutes: 5, title: 'Run speed test' });
    render(<StepGantt steps={[s1, s2]} />);
    expect(screen.getByText(/OVERRUN 2×/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for step #1 to finish/)).toBeInTheDocument();
    expect(screen.getByText(/act 50m/)).toBeInTheDocument(); // actual shown beside estimate
    expect(screen.getByText(/est 20m/)).toBeInTheDocument();
  });

  it('renders action buttons supplied by the page', () => {
    render(<StepGantt steps={[step({ status: 'READY' })]} actions={() => <button>Start</button>} />);
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});

describe('LoadMeter', () => {
  it('shows FULL at capacity', () => {
    render(<LoadMeter active={2} max={2} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('FULL')).toBeInTheDocument();
  });
});

describe('forms', () => {
  it('Login shows inline validation and does not call the API for invalid input', () => {
    wrap(<Login />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByText('Enter your e-mail')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Login demo buttons fill credentials', () => {
    wrap(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Supervisor' }));
    expect(screen.getByLabelText('E-mail')).toHaveValue('supervisor@tixory.test');
  });

  it('New ticket form keeps submit disabled until valid and validates on blur', async () => {
    useAuth.setState({ token: 't', user: { id: 'u', name: 'Op', role: 'OPERATOR', technicianId: null } });
    wrap(<NewTicketDrawer />);
    act(() => useUi.getState().openNewTicket(true));
    const submit = await screen.findByRole('button', { name: /create ticket/i });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'New customer' }));
    const phone = screen.getByLabelText('Phone');
    fireEvent.change(phone, { target: { value: '123' } });
    fireEvent.blur(phone);
    expect(await screen.findByText(/10-15 digits/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });
});
