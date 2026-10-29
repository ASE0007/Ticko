import type { Step, Ticket } from '../src/api/types';

let n = 1000;
export function ticket(over: Partial<Ticket> = {}): Ticket {
  n += 1;
  const now = new Date().toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, number: n, ticketNo: `TX-${n}`, title: `Slow internet ${n}`, description: 'Speed is far below plan',
    category: 'SLOW_SPEED', categoryName: 'Slow speed', priority: 'MEDIUM', escalated: false, status: 'AWAITING_ASSIGNMENT', progress: 15, diagnosis: 'ROUTER_CONFIG', slaState: 'ON_TRACK',
    slaStartedAt: now, slaDeadline: new Date(Date.now() + 3_600_000).toISOString(), forecastFinish: null, estimatedTotalMin: 0, actualTotalMin: 0, reopenCount: 0, cancelReason: null,
    version: 1, createdAt: now, updatedAt: now, resolvedAt: null, closedAt: null,
    customer: { id: 'c1', accountNo: 'ACC-1', name: 'Karim Uddin', phone: '+8801711000001', address: 'Mirpur', area: 'Mirpur', planMbps: 50 },
    technician: null, ...over,
  };
}

export function step(over: Partial<Step> = {}): Step {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`, ticketId: 't', seq: 1, title: 'Check router & connection', status: 'READY', estimatedMinutes: 20, actualMinutes: null,
    requiredSkill: null, assigneeId: null, assigneeName: null, startedAt: null, completedAt: null, dependsOn: [], version: 1, elapsedMinutes: 0, etaMinutes: 20, overrunLevel: 0, overrun: false, ...over,
  };
}
