import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/repositories/prisma';
import { jobQueue } from '../src/queue/jobQueue';
import { loginMany, bearer, createDiagnosedTicket, login, newTicketBody, resetDb, startServer, waitFor, type Seed } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
let seed: Seed;
let op: string, sup: string, admin: string;
const api = () => request(srv.app);

beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await jobQueue.idle().catch(() => undefined);
  seed = await resetDb();
  [op, sup, admin] = await loginMany(srv.app, ['op1@t.test', 'sup@t.test', 'admin@t.test'] as const);
});

async function version(id: string) { return (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.ticket.version as number; }

describe('assignment is concurrency-safe', () => {
  it('two supervisors assigning the SAME ticket at the same time: exactly one wins, no capacity leak', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const v = await version(id);
    const [a, b] = await Promise.all([
      api().post(`/api/tickets/${id}/assign`).set(bearer(sup)).send({ technicianId: seed.techs[0]!.id, version: v }),
      api().post(`/api/tickets/${id}/assign`).set(bearer(admin)).send({ technicianId: seed.techs[1]!.id, version: v }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(['VERSION_CONFLICT', 'ALREADY_ASSIGNED']).toContain(loser.body.error.code);
    const t = (await prisma.ticket.findUnique({ where: { id } }))!;
    expect(t.status).toBe('ASSIGNED');
    const loads = await prisma.technician.findMany();
    expect(loads.reduce((n, x) => n + x.activeTickets, 0)).toBe(1); // loser's reserved slot was rolled back
    expect(await prisma.ticketAssignment.count({ where: { ticketId: id, role: 'PRIMARY', releasedAt: null } })).toBe(1);
  });

  it('technician capacity (max 2) holds even under a burst of parallel assignments', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await createDiagnosedTicket(srv.app, op, seed.customer.id, { title: `Burst ticket ${i}` }));
    const versions = await Promise.all(ids.map(version));
    const results = await Promise.all(ids.map((id, i) => api().post(`/api/tickets/${id}/assign`).set(bearer(sup)).send({ technicianId: seed.techs[0]!.id, version: versions[i] })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    const rejected = results.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(3);
    expect(rejected.every((r) => r.body.error.code === 'TECHNICIAN_AT_CAPACITY')).toBe(true);
    expect((await prisma.technician.findUnique({ where: { id: seed.techs[0]!.id } }))!.activeTickets).toBe(2);
  });

  it('DB itself refuses an impossible state even if app code were wrong', async () => {
    await expect(prisma.technician.update({ where: { id: seed.techs[0]!.id }, data: { activeTickets: 99 } })).rejects.toBeTruthy();
  });

  it('off-duty technicians cannot be assigned', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    await prisma.technician.update({ where: { id: seed.techs[2]!.id }, data: { availability: 'OFF_DUTY' } });
    const r = await api().post(`/api/tickets/${id}/assign`).set(bearer(sup)).send({ technicianId: seed.techs[2]!.id, version: await version(id) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TECHNICIAN_UNAVAILABLE');
  });

  it('suggestions rank skill-matching technicians first', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id); // ROUTER_CONFIG -> ROUTER/WIFI
    const r = await api().get(`/api/tickets/${id}/suggestions`).set(bearer(sup));
    expect(r.body.items[0].technician.name).toBe('Tech Nusrat');
    expect(r.body.items[0].reasons.join(' ')).toContain('Skills match');
  });
});

describe('worker pool', () => {
  it('never runs more jobs than WORKER_CONCURRENCY and the API stays responsive meanwhile', async () => {
    const concurrency = jobQueue.concurrency;
    const N = 8;
    const created = await Promise.all(Array.from({ length: N }, (_, i) =>
      api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id, title: `Parallel ticket ${i}` }))));
    expect(created.every((r) => r.status === 201)).toBe(true);

    let peak = 0;
    const latencies: number[] = [];
    const t0 = Date.now();
    while ((jobQueue.stats().queued > 0 || jobQueue.stats().running > 0) && Date.now() - t0 < 20_000) {
      peak = Math.max(peak, jobQueue.stats().running);
      const s = Date.now();
      await api().get('/healthz').expect(200); // would stall if jobs blocked the event loop
      latencies.push(Date.now() - s);
      await new Promise((r) => setTimeout(r, 10));
    }
    await jobQueue.idle();
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(concurrency);
    expect(Math.max(...latencies)).toBeLessThan(250);
    expect(await prisma.ticket.count({ where: { status: 'AWAITING_ASSIGNMENT' } })).toBe(N);
    expect(await prisma.job.count({ where: { status: 'SUCCEEDED' } })).toBe(N);
  });

  it('a CRITICAL ticket created later is diagnosed before earlier LOW tickets still waiting', async () => {
    const lows = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id, title: `Low ticket ${i}`, priority: 'LOW' }))));
    const crit = await api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id, title: 'Critical outage', priority: 'CRITICAL' }));
    await jobQueue.idle();
    const finished = (id: string) => prisma.job.findFirst({ where: { ticketId: id }, select: { finishedAt: true } }).then((j) => j!.finishedAt!.getTime());
    const critDone = await finished(crit.body.ticket.id);
    const lowDone = await Promise.all(lows.map((r) => finished(r.body.ticket.id)));
    const later = lowDone.filter((t) => t > critDone).length;
    expect(later).toBeGreaterThanOrEqual(3); // the critical job overtook most of the queued LOW jobs
  });

  it('cooperative cancellation aborts a RUNNING job mid-flight', async () => {
    const created = await api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id }));
    const id = created.body.ticket.id;
    const job = await waitFor(async () => { const j = await prisma.job.findFirst({ where: { ticketId: id, status: 'RUNNING' } }); return j && j.progress > 0 ? j : null; });
    expect(await jobQueue.cancelJob(job.id)).toBe(true);
    await waitFor(async () => (await prisma.job.findUnique({ where: { id: job.id } }))!.status === 'CANCELLED');
    expect((await prisma.ticket.findUnique({ where: { id } }))!.status).toBe('DIAGNOSING'); // ticket untouched, job stopped
    expect(await prisma.workStep.count({ where: { ticketId: id } })).toBe(0); // no half-written plan
  });

  it('crash recovery: unfinished jobs found in the DB are re-queued and completed', async () => {
    const created = await api().post('/api/tickets').set(bearer(op)).send(newTicketBody({ customerId: seed.customer.id }));
    const id = created.body.ticket.id;
    await jobQueue.idle();
    // simulate a crash: ticket back to OPEN, job left RUNNING in the database
    await prisma.$transaction([
      prisma.workStep.deleteMany({ where: { ticketId: id } }),
      prisma.ticket.update({ where: { id }, data: { status: 'OPEN', diagnosis: null } }),
      prisma.job.updateMany({ where: { ticketId: id }, data: { status: 'RUNNING', finishedAt: null, progress: 40 } }),
    ]);
    expect(await jobQueue.recover()).toBe(1);
    jobQueue.start();
    await waitFor(async () => (await prisma.ticket.findUnique({ where: { id } }))!.status === 'AWAITING_ASSIGNMENT');
    expect(await prisma.workStep.count({ where: { ticketId: id } })).toBe(5);
  });

  it('report export runs in a worker thread and produces a CSV', async () => {
    await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const r = await api().post('/api/reports/export').set(bearer(sup)).send({});
    expect(r.status).toBe(202);
    const csv = await waitFor(async () => { const d = await api().get(`/api/reports/export/${r.body.jobId}`).set(bearer(sup)); return d.status === 200 ? d : null; });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toContain('Ticket,Status');
    expect(csv.text).toContain('TX-1001');
  });
});
