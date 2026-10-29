import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/repositories/prisma';
import { jobQueue } from '../src/queue/jobQueue';
import { loginMany, bearer, createDiagnosedTicket, login, newTicketBody, resetDb, startServer, waitFor, type Seed } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
let seed: Seed;
let op: string, sup: string, tech1: string, tech2: string, admin: string;

beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await jobQueue.idle().catch(() => undefined);
  seed = await resetDb();
  [op, sup, tech1, tech2, admin] = await loginMany(srv.app, ['op1@t.test', 'sup@t.test', 'rafi@t.test', 'nusrat@t.test', 'admin@t.test'] as const);
});

describe('auth & RBAC', () => {
  it('rejects bad credentials and missing tokens', async () => {
    expect((await request(srv.app).post('/api/auth/login').send({ email: 'op1@t.test', password: 'wrong' })).status).toBe(401);
    expect((await request(srv.app).get('/api/tickets')).status).toBe(401);
    expect((await request(srv.app).get('/api/tickets').set(bearer('garbage'))).status).toBe(401);
  });
  it('enforces roles per endpoint', async () => {
    expect((await request(srv.app).get('/api/jobs').set(bearer(op))).status).toBe(403);
    expect((await request(srv.app).get('/api/users').set(bearer(sup))).status).toBe(403);
    expect((await request(srv.app).get('/api/users').set(bearer(admin))).status).toBe(200);
    expect((await request(srv.app).post('/api/tickets').set(bearer(tech1)).send(newTicketBody({ customerId: seed.customer.id }))).status).toBe(403);
  });
  it('disabled users cannot log in', async () => {
    await prisma.user.update({ where: { id: seed.operator2.id }, data: { active: false } });
    expect((await request(srv.app).post('/api/auth/login').send({ email: 'op2@t.test', password: 'Passw0rd!' })).status).toBe(401);
  });
});

describe('validation & error handling', () => {
  it('returns a uniform 400 envelope with field details', async () => {
    const res = await request(srv.app).post('/api/tickets').set(bearer(op)).send({ title: 'x', description: 'short', category: 'NOPE', priority: 'BAD' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(2);
    expect(res.body.error.requestId).toBeTruthy();
  });
  it('validates inline customer phone format and requires exactly one customer source', async () => {
    const bad = await request(srv.app).post('/api/tickets').set(bearer(op)).send(newTicketBody({ customer: { name: 'Ab', phone: '123', address: 'Somewhere far', planMbps: 20 } }));
    expect(bad.status).toBe(400);
    const none = await request(srv.app).post('/api/tickets').set(bearer(op)).send(newTicketBody());
    expect(none.status).toBe(400);
  });
  it('404 for unknown ticket and unknown route, 400 for bad uuid', async () => {
    expect((await request(srv.app).get('/api/tickets/00000000-0000-4000-8000-000000000000').set(bearer(op))).status).toBe(404);
    expect((await request(srv.app).get('/api/tickets/not-a-uuid').set(bearer(op))).status).toBe(400);
    expect((await request(srv.app).get('/api/nope').set(bearer(op))).status).toBe(404);
  });
});

describe('ticket creation runs diagnostics in the background', () => {
  it('returns 201 immediately, then diagnoses and builds the work plan', async () => {
    const t0 = Date.now();
    const res = await request(srv.app).post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id }));
    expect(res.status).toBe(201);
    expect(Date.now() - t0).toBeLessThan(500); // the 5 probe stages (~100 ms+) did not block the response
    expect(res.body.ticket.status).toBe('OPEN');
    expect(res.body.ticket.ticketNo).toBe('TX-1001');
    const id = res.body.ticket.id;
    await waitFor(async () => (await prisma.ticket.findUnique({ where: { id } }))?.status === 'AWAITING_ASSIGNMENT');
    await jobQueue.idle();
    const detail = await request(srv.app).get(`/api/tickets/${id}`).set(bearer(sup));
    expect(detail.body.ticket.diagnosis).toBe('ROUTER_CONFIG');
    expect(detail.body.steps).toHaveLength(5);
    expect(detail.body.steps.filter((s: any) => s.status === 'READY')).toHaveLength(2); // two independent first steps
    expect(detail.body.steps.find((s: any) => s.title === 'Apply configuration fix').dependsOn).toHaveLength(2);
    expect(detail.body.jobs[0].status).toBe('SUCCEEDED');
    expect(detail.body.ticket.slaDeadline).toBeTruthy();
    const tl = await request(srv.app).get(`/api/tickets/${id}/timeline`).set(bearer(sup));
    expect(tl.body.items.map((i: any) => i.to)).toEqual(expect.arrayContaining(['OPEN', 'DIAGNOSING', 'AWAITING_ASSIGNMENT']));
  });
  it('can create a ticket with an inline new customer', async () => {
    const res = await request(srv.app).post('/api/tickets').set(bearer(op)).send(newTicketBody({ customer: { name: 'New Person', phone: '+8801999888777', address: 'Banani Road 11', planMbps: 30 } }));
    expect(res.status).toBe(201);
    expect(res.body.ticket.customer.planMbps).toBe(30);
  });
});

describe('search, filter, pagination, optimistic locking', () => {
  it('filters by status/priority/q and paginates', async () => {
    for (let i = 0; i < 5; i++) await request(srv.app).post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id, title: `Case number ${i} outage`, priority: i % 2 ? 'LOW' : 'CRITICAL' }));
    const all = await request(srv.app).get('/api/tickets?limit=2&page=2').set(bearer(sup));
    expect(all.body.total).toBe(5);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.totalPages).toBe(3);
    expect((await request(srv.app).get('/api/tickets?priority=CRITICAL').set(bearer(sup))).body.total).toBe(3);
    expect((await request(srv.app).get('/api/tickets?q=number 3').set(bearer(sup))).body.total).toBe(1);
    expect((await request(srv.app).get('/api/tickets?q=TX-1002').set(bearer(sup))).body.total).toBe(1);
    expect((await request(srv.app).get('/api/tickets?q=karim').set(bearer(sup))).body.total).toBe(5);
    expect((await request(srv.app).get('/api/tickets?status=RESOLVED').set(bearer(sup))).body.total).toBe(0);
    expect((await request(srv.app).get('/api/tickets?status=BOGUS').set(bearer(sup))).status).toBe(400);
  });
  it('detects conflicting edits with 409 VERSION_CONFLICT', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const v = (await request(srv.app).get(`/api/tickets/${id}`).set(bearer(op))).body.ticket.version;
    const a = await request(srv.app).patch(`/api/tickets/${id}`).set(bearer(op)).send({ title: 'Edited by Alice', version: v });
    expect(a.status).toBe(200);
    const b = await request(srv.app).patch(`/api/tickets/${id}`).set(bearer(sup)).send({ title: 'Edited by Bob', version: v });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('cancellation', () => {
  it('operators can only cancel their own tickets; cancel aborts the running job', async () => {
    const created = await request(srv.app).post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id }));
    const id = created.body.ticket.id;
    const op2 = await login(srv.app, 'op2@t.test');
    expect((await request(srv.app).post(`/api/tickets/${id}/cancel`).set(bearer(op2)).send({ reason: 'not mine' })).status).toBe(403);
    expect((await request(srv.app).post(`/api/tickets/${id}/cancel`).set(bearer(op)).send({ reason: 'x' })).status).toBe(400);
    const res = await request(srv.app).post(`/api/tickets/${id}/cancel`).set(bearer(op)).send({ reason: 'Customer called back, resolved by itself' });
    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe('CANCELLED');
    await jobQueue.idle();
    const job = await prisma.job.findFirst({ where: { ticketId: id } });
    expect(['CANCELLED', 'SUCCEEDED']).toContain(job!.status);
    expect((await prisma.ticket.findUnique({ where: { id } }))!.status).toBe('CANCELLED'); // never resurrected by the worker
    expect((await request(srv.app).post(`/api/tickets/${id}/cancel`).set(bearer(op)).send({ reason: 'again' })).status).toBe(422);
  });
});
