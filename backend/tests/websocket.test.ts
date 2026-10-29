import request from 'supertest';
import WebSocket from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/repositories/prisma';
import { jobQueue } from '../src/queue/jobQueue';
import { loginMany, bearer, createDiagnosedTicket, login, newTicketBody, resetDb, startServer, waitFor, type Seed } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
let seed: Seed;
let op: string, sup: string, rafi: string;
const api = () => request(srv.app);

interface Msg { seq: number; type: string; room?: string; payload: any }
function connect(auth: Record<string, string> | null) {
  return new Promise<{ ws: WebSocket; msgs: Msg[]; closed: Promise<number> }>((resolve) => {
    const ws = new WebSocket(srv.wsUrl);
    const msgs: Msg[] = [];
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => { if (auth) ws.send(JSON.stringify({ type: 'auth', ...auth })); resolve({ ws, msgs, closed }); });
  });
}
const types = (m: Msg[]) => m.map((x) => x.type);

beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await jobQueue.idle().catch(() => undefined);
  seed = await resetDb();
  [op, sup, rafi] = await loginMany(srv.app, ['op1@t.test', 'sup@t.test', 'rafi@t.test'] as const);
});

describe('WebSocket real-time updates (no polling)', () => {
  it('rejects bad tokens and closes unauthenticated sockets that send other messages first', async () => {
    const bad = await connect({ token: 'nope' });
    expect(await bad.closed).toBe(4401);
    const anon = await connect(null);
    anon.ws.send(JSON.stringify({ type: 'subscribe', room: 'ticket:00000000-0000-4000-8000-000000000000' }));
    expect(await anon.closed).toBe(4401);
  });

  it('pushes ticket.created, live job.progress and status changes to supervisors', async () => {
    const s = await connect({ token: sup });
    await waitFor(() => types(s.msgs).includes('system.hello'));
    const res = await api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id }));
    const id = res.body.ticket.id;
    await waitFor(() => s.msgs.some((m) => m.type === 'ticket.status_changed' && m.payload.to === 'AWAITING_ASSIGNMENT'));
    await waitFor(() => types(s.msgs).includes('job.completed')); // arrives right after the status change
    const t = types(s.msgs);
    expect(t).toContain('ticket.created');
    expect(t).toContain('job.started');
    expect(s.msgs.filter((m) => m.type === 'job.progress').length).toBeGreaterThanOrEqual(5);
    const progress = s.msgs.filter((m) => m.type === 'job.progress' && m.payload.ticketId === id).map((m) => m.payload.progress);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress); // monotonic live progress
    expect(t).toContain('job.completed');
    const seqs = s.msgs.filter((m) => m.seq > 0).map((m) => m.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // at most one copy of each event
    s.ws.close();
  });

  it('routes events by audience: technicians only see their own tickets', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const tech = await connect({ token: rafi });
    await waitFor(() => types(tech.msgs).includes('system.hello'));
    await createDiagnosedTicket(srv.app, op, seed.customer.id, { title: 'Another customer problem' });
    expect(types(tech.msgs)).not.toContain('ticket.created');
    expect(tech.msgs.some((m) => m.type === 'job.progress')).toBe(false);
    const v = (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.ticket.version;
    await api().post(`/api/tickets/${id}/assign`).set(bearer(sup)).send({ technicianId: seed.techs[0]!.id, version: v }).expect(200);
    await waitFor(() => types(tech.msgs).includes('ticket.assigned'));
    tech.ws.close();
  });

  it('customer tracking sockets get sanitised events only', async () => {
    const created = await api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id }));
    const token = (await api().get(`/api/tickets/${created.body.ticket.id}`).set(bearer(sup))).body.trackToken;
    const c = await connect({ trackToken: token });
    await waitFor(() => types(c.msgs).includes('system.hello'));
    await waitFor(() => c.msgs.some((m) => m.type === 'ticket.status_changed' && m.payload.ticket?.status === 'AWAITING_ASSIGNMENT'));
    const raw = JSON.stringify(c.msgs);
    expect(raw).not.toContain('+8801711');
    expect(raw).not.toContain('Mirpur DOHS');
    expect(types(c.msgs)).not.toContain('metrics.updated');
    c.ws.close();
  });

  it('resume replays missed events after a reconnect', async () => {
    const first = await connect({ token: sup });
    await waitFor(() => types(first.msgs).includes('system.hello'));
    const lastSeq = first.msgs.find((m) => m.type === 'system.hello')!.payload.seq as number;
    first.ws.close();
    await createDiagnosedTicket(srv.app, op, seed.customer.id); // happens while the supervisor is offline
    const again = await connect({ token: sup });
    await waitFor(() => types(again.msgs).includes('system.hello'));
    again.ws.send(JSON.stringify({ type: 'resume', lastSeq }));
    await waitFor(() => types(again.msgs).includes('system.resumed'));
    expect(types(again.msgs)).toContain('ticket.created');
    expect(again.msgs.find((m) => m.type === 'system.resumed')!.payload.replayed).toBeGreaterThan(3);
    again.ws.close();
  });
});
