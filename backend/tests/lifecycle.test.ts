import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/repositories/prisma';
import { jobQueue } from '../src/queue/jobQueue';
import { scheduler } from '../src/services/slaScheduler';
import { invalidatePolicyCache } from '../src/services/slaPolicy';
import { loginMany, bearer, createDiagnosedTicket, login, resetDb, startServer, waitFor, type Seed } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
let seed: Seed;
let op: string, sup: string, rafi: string, nusrat: string;

beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await jobQueue.idle().catch(() => undefined);
  seed = await resetDb();
  [op, sup, rafi, nusrat] = await loginMany(srv.app, ['op1@t.test', 'sup@t.test', 'rafi@t.test', 'nusrat@t.test'] as const);
});

const api = () => request(srv.app);
async function version(id: string) { return (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.ticket.version as number; }
async function assign(id: string, techId: string, token = sup, v?: number) {
  return api().post(`/api/tickets/${id}/assign`).set(bearer(token)).send({ technicianId: techId, version: v ?? (await version(id)) });
}
async function steps(id: string) { return (await api().get(`/api/tickets/${id}/steps`).set(bearer(sup))).body.steps as any[]; }
const byTitle = (s: any[], t: string) => s.find((x) => x.title === t);

describe('full lifecycle: complaint -> diagnosis -> assign -> steps -> verify -> customer confirm', () => {
  it('walks the happy path and releases technician capacity', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    expect((await assign(id, seed.techs[1]!.id)).status).toBe(200);
    expect((await prisma.technician.findUnique({ where: { id: seed.techs[1]!.id } }))!.activeTickets).toBe(1);

    // dependency (not the clock!) controls order: "Apply configuration fix" is LOCKED
    let s = await steps(id);
    const router = byTitle(s, 'Check router & connection'), wifi = byTitle(s, 'Check Wi-Fi interference'), fix = byTitle(s, 'Apply configuration fix');
    expect(fix.status).toBe('LOCKED');
    expect((await api().post(`/api/steps/${fix.id}/start`).set(bearer(nusrat))).body.error.code).toBe('STEP_LOCKED');

    // only the owner (or manager) may work the ticket
    expect((await api().post(`/api/steps/${router.id}/start`).set(bearer(rafi))).status).toBe(403);
    expect((await api().post(`/api/steps/${router.id}/start`).set(bearer(nusrat))).status).toBe(200);
    expect((await prisma.ticket.findUnique({ where: { id } }))!.status).toBe('IN_PROGRESS');
    expect((await api().post(`/api/steps/${router.id}/start`).set(bearer(nusrat))).status).toBe(409); // double start

    // independent step can run in parallel
    expect((await api().post(`/api/steps/${wifi.id}/start`).set(bearer(nusrat))).status).toBe(200);
    await api().post(`/api/steps/${router.id}/complete`).set(bearer(nusrat)).send({}).expect(200);
    expect(byTitle(await steps(id), 'Apply configuration fix').status).toBe('LOCKED'); // wifi step still running
    await api().post(`/api/steps/${wifi.id}/complete`).set(bearer(nusrat)).send({}).expect(200);
    expect(byTitle(await steps(id), 'Apply configuration fix').status).toBe('READY'); // both prerequisites done

    // cannot ask for verification while work is unfinished
    expect((await api().post(`/api/tickets/${id}/request-verification`).set(bearer(nusrat)).send({})).body.error.code).toBe('STEPS_INCOMPLETE');

    for (const t of ['Apply configuration fix', 'Run speed test', 'Verify result & update customer']) {
      const st = byTitle(await steps(id), t);
      await api().post(`/api/steps/${st.id}/start`).set(bearer(nusrat)).expect(200);
      await api().post(`/api/steps/${st.id}/complete`).set(bearer(nusrat)).send({ note: 'ok' }).expect(200);
    }
    const v = await api().post(`/api/tickets/${id}/request-verification`).set(bearer(nusrat)).send({ simulate: 'PASS' });
    expect(v.status).toBe(202);
    expect((await prisma.ticket.findUnique({ where: { id } }))!.status).toBe('VERIFYING'); // immediate, job runs in background
    await waitFor(async () => (await prisma.ticket.findUnique({ where: { id } }))?.status === 'RESOLVED');
    expect((await prisma.technician.findUnique({ where: { id: seed.techs[1]!.id } }))!.activeTickets).toBe(0); // freed

    // customer confirms through the PUBLIC tracking link (no login)
    const token = (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.trackToken;
    const view = await api().get(`/api/public/track/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.customerCanRespond).toBe(true);
    expect(JSON.stringify(view.body)).not.toContain('+88017'); // no phone number leaks
    expect((await api().post(`/api/public/track/${token}/confirm`)).status).toBe(200);
    expect((await prisma.ticket.findUnique({ where: { id } }))!.status).toBe('CLOSED');
    expect((await api().get('/api/public/track/this-token-does-not-exist-123456')).status).toBe(404);

    const tl = (await api().get(`/api/tickets/${id}/timeline`).set(bearer(sup))).body.items.map((i: any) => i.to);
    expect(tl).toEqual(expect.arrayContaining(['OPEN', 'DIAGNOSING', 'ASSIGNED', 'IN_PROGRESS', 'VERIFYING', 'RESOLVED', 'CLOSED']));
  });

  it('failed verification sends the ticket back to work; customer "still broken" reopens it with priority bump', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id, { priority: 'LOW' });
    await assign(id, seed.techs[1]!.id);
    for (const s of await steps(id)) {
      await prisma.workStep.update({ where: { id: s.id }, data: { status: 'DONE', startedAt: new Date(), completedAt: new Date(), actualMinutes: 5 } });
    }
    await prisma.ticket.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    await api().post(`/api/tickets/${id}/request-verification`).set(bearer(nusrat)).send({ simulate: 'FAIL' }).expect(202);
    await waitFor(async () => { const t = await prisma.ticket.findUnique({ where: { id } }); return t?.status === 'IN_PROGRESS' && (await prisma.workStep.count({ where: { ticketId: id, title: { startsWith: 'Re-check' } } })) === 1; });

    for (const s of await steps(id)) if (s.status !== 'DONE') {
      await api().post(`/api/steps/${s.id}/start`).set(bearer(nusrat)).expect(200);
      await api().post(`/api/steps/${s.id}/complete`).set(bearer(nusrat)).send({}).expect(200);
    }
    await api().post(`/api/tickets/${id}/request-verification`).set(bearer(nusrat)).send({ simulate: 'PASS' }).expect(202);
    await waitFor(async () => (await prisma.ticket.findUnique({ where: { id } }))?.status === 'RESOLVED');

    const token = (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.trackToken;
    expect((await api().post(`/api/public/track/${token}/report-issue`).send({ note: 'Still slow in the evening' })).status).toBe(200);
    const t = await prisma.ticket.findUnique({ where: { id } });
    expect(t!.status).toBe('REOPENED');
    expect(t!.priority).toBe('MEDIUM'); // LOW -> MEDIUM
    expect(t!.reopenCount).toBe(1);
    expect(t!.technicianId).toBeNull();
    expect(await assign(id, seed.techs[2]!.id).then((r) => r.status)).toBe(200); // can be assigned again
  });
});

describe('estimate vs actual: the 20-minute task that takes much longer', () => {
  it('flags OVERRUN live, keeps the next step LOCKED, never auto-completes, and shows estimated vs actual', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    await assign(id, seed.techs[1]!.id);
    const router = byTitle(await steps(id), 'Check router & connection'); // estimate 20 sim-min = 2 real s at scale 600
    await api().post(`/api/steps/${router.id}/start`).set(bearer(nusrat)).expect(200);
    scheduler.start();

    const overrun = await waitFor(async () => (await prisma.workStep.findUnique({ where: { id: router.id } }))!.lastOverrunLevel >= 1, 6000, 'overrun flag');
    expect(overrun).toBe(true);
    const mid = await steps(id);
    expect(byTitle(mid, 'Check router & connection').status).toBe('IN_PROGRESS'); // system did NOT stop the technician
    expect(byTitle(mid, 'Check router & connection').overrun).toBe(true);
    expect(byTitle(mid, 'Apply configuration fix').status).toBe('LOCKED'); // dependants keep waiting
    expect((await prisma.statusHistory.count({ where: { ticketId: id, toValue: { startsWith: 'OVERRUN' } } }))).toBeGreaterThanOrEqual(1);

    await waitFor(async () => (await prisma.workStep.findUnique({ where: { id: router.id } }))!.lastOverrunLevel === 3, 8000, '2.0x level');
    await api().post(`/api/steps/${router.id}/complete`).set(bearer(nusrat)).send({}).expect(200);
    scheduler.stop();
    const done = byTitle(await steps(id), 'Check router & connection');
    expect(done.actualMinutes).toBeGreaterThan(done.estimatedMinutes * 2 - 1);
    const t = (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.ticket;
    expect(t.estimatedTotalMin).toBe(60);
    expect(t.actualTotalMin).toBeGreaterThan(t.estimatedTotalMin * 0 + 39); // actual is visible, not hidden
  });
});

describe('SLA: predictive AT_RISK, WARNING, BREACHED and auto-escalation', () => {
  it('escalates priority once and marks breach when the window is tiny', async () => {
    await prisma.slaPolicy.update({ where: { priority: 'MEDIUM' }, data: { resolutionMinutes: 20 } }); // 2 real seconds at scale 600
    invalidatePolicyCache();
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id, { priority: 'MEDIUM' });
    scheduler.start();
    await waitFor(async () => (await prisma.ticket.findUnique({ where: { id } }))!.slaState === 'BREACHED', 8000, 'breach');
    scheduler.stop();
    const t = (await prisma.ticket.findUnique({ where: { id } }))!;
    expect(t.escalated).toBe(true);
    expect(t.priority).toBe('HIGH');
    expect(await prisma.statusHistory.count({ where: { ticketId: id, message: { contains: 'auto-escalated' } } })).toBe(1); // exactly once
  });
});
