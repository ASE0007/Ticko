import { describe, expect, it } from 'vitest';
import { fmtMinutes, simMinutes, timeAgo } from '../src/lib/format';
import { loginSchema, ticketFormSchema, zodErrors } from '../src/lib/schemas';

describe('formatting', () => {
  it('formats simulated minutes', () => {
    expect([fmtMinutes(0), fmtMinutes(42), fmtMinutes(65), fmtMinutes(26 * 60)]).toEqual(['0m', '42m', '1h 05m', '1d 2h']);
  });
  it('scales elapsed time by the demo time scale', () => {
    const t0 = new Date('2026-01-01T00:00:00Z').getTime();
    expect(simMinutes(t0, t0 + 1000, 60)).toBe(1);
    expect(simMinutes(t0, t0 + 60_000, 1)).toBe(1);
  });
  it('humanises ages', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 90_000).toISOString(), now)).toBe('1m ago');
    expect(timeAgo(new Date(now - 2000).toISOString(), now)).toBe('just now');
  });
});

describe('form validation (mirrors the server)', () => {
  const base = { title: 'Internet very slow', description: 'Speed is far below the plan', category: 'SLOW_SPEED', priority: 'HIGH' } as const;
  it('accepts an existing customer', () => {
    expect(ticketFormSchema.safeParse({ ...base, customerId: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
  });
  it('rejects short text, bad phone and missing customer with field-level messages', () => {
    const r = ticketFormSchema.safeParse({ title: 'x', description: 'short', category: 'SLOW_SPEED', priority: 'HIGH', customer: { name: 'A', phone: '12', address: 'x', planMbps: '0' } });
    expect(r.success).toBe(false);
    if (r.success) throw new Error('expected failure');
    const e = zodErrors(r.error);
    expect(e['title']).toContain('at least 5');
    expect(e['description']).toContain('min 10');
    expect(e['customer.phone']).toContain('10-15 digits');
    expect(e['customer.planMbps']).toContain('At least 1');
    const none = ticketFormSchema.safeParse(base);
    if (none.success) throw new Error('expected failure');
    expect(zodErrors(none.error)['customerId']).toContain('Choose');
  });
  it('coerces plan speed typed as text', () => {
    const r = ticketFormSchema.safeParse({ ...base, customer: { name: 'New Person', phone: '+8801999888777', address: 'Banani road 11', planMbps: '30' } });
    expect(r.success && r.data.customer?.planMbps).toBe(30);
  });
  it('validates login fields', () => {
    const bad = loginSchema.safeParse({ email: 'nope', password: '' });
    if (bad.success) throw new Error('expected failure');
    expect(zodErrors(bad.error)).toMatchObject({ email: expect.stringContaining('e-mail'), password: expect.any(String) });
  });
});
