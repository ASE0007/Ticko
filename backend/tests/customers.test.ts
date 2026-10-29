import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/repositories/prisma';
import { jobQueue } from '../src/queue/jobQueue';
import { bearer, loginMany, newTicketBody, resetDb, startServer, type Seed } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
let seed: Seed;
let op: string, tech: string;

beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await jobQueue.idle().catch(() => undefined);
  seed = await resetDb();
  [op, tech] = await loginMany(srv.app, ['op1@t.test', 'rafi@t.test'] as const);
});

const body = (over: Record<string, unknown> = {}) => ({ name: 'Nadia Islam', phone: '+8801811000002', address: 'House 5, Road 3, Banani', area: 'Banani', planMbps: 30, ...over });

describe('customers: register before any ticket exists', () => {
  it('creates a customer with a generated account number, then lists and finds it', async () => {
    const res = await request(srv.app).post('/api/customers').set(bearer(op)).send(body());
    expect(res.status).toBe(201);
    expect(res.body.customer).toMatchObject({ name: 'Nadia Islam', planMbps: 30, ticketCount: 0 });
    expect(res.body.customer.accountNo).toMatch(/^ACC-[0-9A-F]{6}$/);
    const found = await request(srv.app).get('/api/customers?q=Nadia').set(bearer(op));
    expect(found.body.items.map((c: { name: string }) => c.name)).toEqual(['Nadia Islam']);
  });

  it('refuses a second customer with the same phone number (409) and bad input (400)', async () => {
    await request(srv.app).post('/api/customers').set(bearer(op)).send(body());
    const dup = await request(srv.app).post('/api/customers').set(bearer(op)).send(body({ name: 'Someone Else' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CUSTOMER_EXISTS');
    expect((await request(srv.app).post('/api/customers').set(bearer(op)).send(body({ phone: '123' }))).status).toBe(400);
  });

  it('a saved customer can be picked later when filing a ticket; technicians cannot manage customers', async () => {
    const c = (await request(srv.app).post('/api/customers').set(bearer(op)).send(body())).body.customer;
    const t = await request(srv.app).post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: c.id }));
    expect(t.status).toBe(201);
    const list = await request(srv.app).get('/api/customers?q=ACC').set(bearer(op));
    expect(list.body.items.find((x: { id: string }) => x.id === c.id).ticketCount).toBe(1);
    expect((await request(srv.app).post('/api/customers').set(bearer(tech)).send(body({ phone: '+8801811000003' }))).status).toBe(403);
  });

  it('edits a customer but not into another customer’s phone number', async () => {
    const a = (await request(srv.app).post('/api/customers').set(bearer(op)).send(body())).body.customer;
    const ok = await request(srv.app).patch(`/api/customers/${a.id}`).set(bearer(op)).send({ planMbps: 100, address: 'New address 12, Gulshan' });
    expect(ok.status).toBe(200);
    expect(ok.body.customer.planMbps).toBe(100);
    const clash = await request(srv.app).patch(`/api/customers/${a.id}`).set(bearer(op)).send({ phone: seed.customer.phone });
    expect(clash.status).toBe(409);
  });
});
