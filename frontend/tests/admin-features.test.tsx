import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepDialog } from '../src/components/StepDialog';
import { UserDialog, generatePassword } from '../src/components/UserDialog';
import { ChangePasswordDialog } from '../src/components/ChangePasswordDialog';
import { DayReport } from '../src/components/DayReport';
import Settings from '../src/pages/Settings';
import { useAuth } from '../src/store/auth';
import { useData } from '../src/store/data';
import { useUi } from '../src/store/ui';
import { step } from './fixtures';
import { passwordSchema } from '../src/lib/schemas';
import { toLocalDateInput } from '../src/lib/format';

const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(handler: (path: string, method: string, body: any) => unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('/api', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: path, method, body });
    const out = handler(path, method, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? {}), { status: 200 });
  }));
}
const err = (status: number, code: string, message: string, details?: unknown) => new Response(JSON.stringify({ error: { code, message, details } }), { status });

beforeEach(() => {
  useData.getState().reset();
  useUi.setState({ toasts: [], timeScale: 1, newTicketOpen: false });
  useAuth.setState({ token: 't', user: { id: 'a', name: 'Admin A', role: 'ADMIN', technicianId: null } });
});

const planSteps = () => {
  const s1 = step({ id: 's1', seq: 1, title: 'Check router', status: 'DONE', estimatedMinutes: 20, actualMinutes: 50 });
  const s2 = step({ id: 's2', seq: 2, title: 'Apply fix', status: 'READY', dependsOn: ['s1'] });
  const s3 = step({ id: 's3', seq: 3, title: 'Run speed test', status: 'LOCKED', dependsOn: ['s2'] });
  return [s1, s2, s3];
};

describe('StepDialog: which step comes after which', () => {
  it('previews the chain and posts insertAfter so waiting steps are re-routed', async () => {
    mockFetch(() => ({}));
    const onClose = vi.fn();
    render(<StepDialog open ticketId="t1" steps={planSteps()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'Reboot ONT' } });
    fireEvent.click(screen.getByRole('radio', { name: /Put it between steps/i }));
    fireEvent.change(screen.getByLabelText('Insert right after'), { target: { value: 's2' } });
    const preview = screen.getByText('What will happen').parentElement!;
    expect(within(preview).getByText(/#2 Apply fix/)).toBeInTheDocument();
    expect(within(preview).getByText(/NEW: Reboot ONT/)).toBeInTheDocument();
    expect(within(preview).getByText(/#3 Run speed test/)).toBeInTheDocument(); // the step that will now wait for the new one
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ url: '/tickets/t1/steps', method: 'POST', body: { title: 'Reboot ONT', estimatedMinutes: 15, insertAfter: 's2', dependsOn: [] } });
  });

  it('"start at once" sends no dependencies; "after" requires choosing at least one step', async () => {
    mockFetch(() => ({}));
    render(<StepDialog open ticketId="t1" steps={planSteps()} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'Take cabling photo' } });
    fireEvent.click(screen.getByRole('radio', { name: /Start at once/i }));
    expect(screen.getByText('What will happen').parentElement!.textContent).toContain('start at once');
    fireEvent.click(screen.getByRole('radio', { name: /Start after other steps/i }));
    for (const box of screen.getAllByRole('checkbox')) if ((box as HTMLInputElement).checked) fireEvent.click(box); // untick the default
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Choose which step/);
    expect(calls).toHaveLength(0);
  });

  it('editing hides steps that would create a cycle and locks dependencies of a running step', () => {
    mockFetch(() => ({}));
    const steps = planSteps();
    render(<StepDialog open ticketId="t1" steps={steps} editing={steps[1]!} onClose={() => undefined} />);
    const group = screen.getByRole('group', { name: 'Wait for' });
    expect(within(group).getByText('Check router')).toBeInTheDocument();
    expect(within(group).queryByText('Run speed test')).toBeNull(); // #3 already waits for #2: choosing it would loop
    expect(within(group).queryByText('Apply fix')).toBeNull(); // not itself
  });
});

describe('Admin user management form', () => {
  it('validates fields, suggests a strong password and shows credentials after creation', async () => {
    mockFetch((path, method) => (method === 'POST' && path === '/users' ? { user: { id: 'n' } } : {}));
    const onSaved = vi.fn();
    render(<UserDialog open editing={null} onClose={() => undefined} onSaved={onSaved} />);
    expect(passwordSchema.safeParse((screen.getByLabelText('Password') as HTMLInputElement).value).success).toBe(true); // generated suggestion is valid
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter an e-mail')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Tech Karim' } });
    fireEvent.change(screen.getByLabelText('E-mail (login)'), { target: { value: 'Karim.Tech@Example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ url: '/users', method: 'POST', body: { name: 'Tech Karim', email: 'karim.tech@example.com', role: 'TECHNICIAN', maxActive: 2 } });
    expect(screen.getByText(/E-mail: karim.tech@example.com/)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it('maps a duplicate e-mail error onto the e-mail field', async () => {
    mockFetch(() => err(409, 'EMAIL_IN_USE', 'That e-mail is already used by another account.'));
    render(<UserDialog open editing={null} onClose={() => undefined} onSaved={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Someone' } });
    fireEvent.change(screen.getByLabelText('E-mail (login)'), { target: { value: 'rafi@tixory.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('That e-mail is already used by another account.')).toBeInTheDocument();
  });

  it('editing sends only what changed; a new password warns about sign-out; technician role cannot be converted', async () => {
    mockFetch(() => ({}));
    const tech = { id: 'u9', name: 'Rafi Ahmed', email: 'rafi@tixory.test', role: 'TECHNICIAN', active: true, createdAt: '', technicianId: 't9', skills: ['FIBER'], maxActive: 2, activeTickets: 1, availability: 'AVAILABLE' } as const;
    render(<UserDialog open editing={tech as never} onClose={() => undefined} onSaved={() => undefined} />);
    expect(screen.getByRole('radio', { name: /Admin/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Set a new password/), { target: { value: 'NewPass123' } });
    expect(screen.getByText(/signed out everywhere/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('E-mail (login)'), { target: { value: 'rafi.new@tixory.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({ url: '/users/u9', method: 'PATCH', body: { email: 'rafi.new@tixory.test', password: 'NewPass123', skills: ['FIBER'], maxActive: 2, active: true } });
    expect(calls[0]!.body.role).toBeUndefined();
  });

  it('generated passwords satisfy the policy', () => {
    for (let i = 0; i < 20; i++) expect(passwordSchema.safeParse(generatePassword()).success).toBe(true);
  });
});

describe('Change my password', () => {
  it('checks the confirmation locally, then swaps in the fresh token', async () => {
    mockFetch(() => ({ token: 'NEW-TOKEN', user: { id: 'a', name: 'Admin A', role: 'ADMIN', technicianId: null } }));
    render(<ChangePasswordDialog open onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Passw0rd!' } });
    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: 'Another123' } });
    fireEvent.change(screen.getByLabelText('Repeat new password'), { target: { value: 'Different1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Repeat new password'), { target: { value: 'Another123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(useAuth.getState().token).toBe('NEW-TOKEN'));
    expect(calls[0]).toMatchObject({ url: '/auth/change-password', body: { currentPassword: 'Passw0rd!', newPassword: 'Another123' } });
  });
});

describe('Settings: add a new ticket category', () => {
  it('lists categories, adds a custom one with its work plan, and refreshes the shared list', async () => {
    const list = [{ code: 'SLOW_SPEED', name: 'Slow speed', description: null, planTemplate: 'UNKNOWN', defaultPriority: 'MEDIUM', active: true, builtin: true, sortOrder: 1, ticketCount: 4 }];
    mockFetch((path, method, body) => {
      if (path.startsWith('/categories') && method === 'POST') { list.push({ code: 'FIBER_CUT', name: body.name, description: null, planTemplate: body.planTemplate, defaultPriority: 'MEDIUM', active: true, builtin: false, sortOrder: 2, ticketCount: 0 }); return { category: {} }; }
      if (path.startsWith('/categories')) return { items: list };
      if (path.startsWith('/sla-policies')) return { items: [{ priority: 'HIGH', resolutionMinutes: 480, warningPct: 75 }] };
      return {};
    });
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(await screen.findByText('Slow speed')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Fiber cut' } });
    fireEvent.change(screen.getByLabelText('Work plan template'), { target: { value: 'LINE_FAULT' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(await screen.findByText('Fiber cut')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ name: 'Fiber cut', planTemplate: 'LINE_FAULT' });
    expect(useData.getState().categories.map((c) => c.code)).toContain('FIBER_CUT'); // New-ticket form sees it immediately
  });
});

describe('Technician day report', () => {
  it('shows exactly what was done, with times, estimate vs actual and overruns', async () => {
    const day = toLocalDateInput(new Date());
    const at = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
    mockFetch(() => ({
      technician: { id: 't1', name: 'Nusrat Jahan', email: 'nusrat@tixory.test', skills: ['ROUTER'] },
      range: { from: at(0, 0), to: at(23, 59) },
      summary: { stepsCompleted: 2, stepsInProgress: 1, ticketsWorked: 2, ticketsAssigned: 2, ticketsResolved: 1, estimatedMinutes: 25, actualMinutes: 58, accuracyPct: 232, overrunSteps: 1, overrunMinutes: 30, activeMinutes: 70, idleMinutes: 15, firstActivity: at(9, 5), lastActivity: at(11, 40) },
      items: [
        { stepId: 'a', ticketId: 'k1', ticketNo: 'TX-1001', ticketTitle: 'Slow', priority: 'HIGH', customer: 'Karim', area: 'Mirpur', step: 'Check router & connection', seq: 1, status: 'DONE', startedAt: at(9, 5), completedAt: at(9, 55), estimatedMinutes: 20, actualMinutes: 50, overrunMinutes: 30, overrun: true, note: 'Completed: Check router - estimated 20 min, actual 50 min (+30 min over). Note: firmware was outdated' },
        { stepId: 'b', ticketId: 'k1', ticketNo: 'TX-1001', ticketTitle: 'Slow', priority: 'HIGH', customer: 'Karim', area: 'Mirpur', step: 'Run speed test', seq: 2, status: 'DONE', startedAt: at(10, 10), completedAt: at(10, 18), estimatedMinutes: 5, actualMinutes: 8, overrunMinutes: 3, overrun: true, note: null },
        { stepId: 'c', ticketId: 'k2', ticketNo: 'TX-1002', ticketTitle: 'No link', priority: 'LOW', customer: 'Farhana', area: null, step: 'Inspect line', seq: 1, status: 'IN_PROGRESS', startedAt: at(11, 0), completedAt: null, estimatedMinutes: 25, actualMinutes: 40, overrunMinutes: 15, overrun: true, note: null },
      ],
      assignedTickets: [{ ticketNo: 'TX-1001', title: 'Slow', at: at(9, 0) }],
      resolvedTickets: [{ id: 'k1', ticketNo: 'TX-1001', title: 'Slow', at: at(10, 30), sla: 'ON_TRACK' }],
    }));
    render(<MemoryRouter><DayReport technicianId="t1" date={day} /></MemoryRouter>);
    expect(await screen.findByTestId('day-report')).toBeInTheDocument();
    expect(screen.getByText('Nusrat Jahan')).toBeInTheDocument();
    expect(screen.getByText('Steps completed').parentElement).toHaveTextContent('2');
    expect(screen.getByText(/1 running now/)).toBeInTheDocument();
    expect(screen.getByText('+30m')).toBeInTheDocument(); // overrun is called out, not hidden
    expect(screen.getAllByText('Check router & connection').length).toBeGreaterThan(0); // table + mobile list (CSS shows one)
    expect(screen.getByText('firmware was outdated')).toBeInTheDocument(); // technician's own completion note
    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('day-timeline')).getAllByRole('link')).toHaveLength(3); // one block per task on the 24h strip
    expect(screen.getByRole('button', { name: /CSV/ })).toBeInTheDocument();
    expect(calls[0]!.url).toMatch(/^\/reports\/technicians\/t1\/day\?from=.*&to=/);
  });
});
