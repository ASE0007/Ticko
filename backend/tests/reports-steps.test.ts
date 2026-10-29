import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/repositories/prisma';
import { jobQueue } from '../src/queue/jobQueue';
import { bearer, createDiagnosedTicket, loginMany, resetDb, startServer, type Seed } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
let seed: Seed;
let op: string, sup: string, rafi: string, nusrat: string;
const api = () => request(srv.app);

beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await jobQueue.idle().catch(() => undefined);
  seed = await resetDb();
  [op, sup, rafi, nusrat] = await loginMany(srv.app, ['op1@t.test', 'sup@t.test', 'rafi@t.test', 'nusrat@t.test'] as const);
});

async function steps(id: string) { return (await api().get(`/api/tickets/${id}/steps`).set(bearer(sup))).body.steps as any[]; }
const by = (s: any[], t: string) => s.find((x) => x.title === t);
async function assignTo(id: string, techId: string) {
  const v = (await api().get(`/api/tickets/${id}`).set(bearer(sup))).body.ticket.version;
  await api().post(`/api/tickets/${id}/assign`).set(bearer(sup)).send({ technicianId: techId, version: v }).expect(200);
}

describe('"which step comes after which"', () => {
  it('insertAfter puts the new step in the chain and re-routes the steps that were waiting', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const before = await steps(id);
    const fix = by(before, 'Apply configuration fix');
    const speed = by(before, 'Run speed test');
    expect(speed.dependsOn).toEqual([fix.id]);

    const r = await api().post(`/api/tickets/${id}/steps`).set(bearer(sup)).send({ title: 'Reboot ONT', estimatedMinutes: 10, insertAfter: fix.id });
    expect(r.status).toBe(201);
    const after = await steps(id);
    expect(after.map((s) => s.title)).toEqual(['Check router & connection', 'Check Wi-Fi interference', 'Apply configuration fix', 'Reboot ONT', 'Run speed test', 'Verify result & update customer']);
    expect(after.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    const reboot = by(after, 'Reboot ONT');
    expect(reboot.dependsOn).toEqual([fix.id]); // runs after the fix
    expect(by(after, 'Run speed test').dependsOn).toEqual([reboot.id]); // speed test now waits for the new step
    expect(reboot.status).toBe('LOCKED');
  });

  it('plain dependsOn=[] makes the step independent (can run in parallel); dependsOn=[x] waits for x', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const base = await steps(id);
    const par = (await api().post(`/api/tickets/${id}/steps`).set(bearer(sup)).send({ title: 'Photo of cabling', estimatedMinutes: 5, dependsOn: [] })).body.step;
    expect(par.status).toBe('READY');
    expect(par.dependsOn).toEqual([]);
    const seq = (await api().post(`/api/tickets/${id}/steps`).set(bearer(sup)).send({ title: 'After wifi check', estimatedMinutes: 5, dependsOn: [by(base, 'Check Wi-Fi interference').id] })).body.step;
    expect(seq.status).toBe('LOCKED');
  });

  it('the order can be edited later (change what a step waits for) and cycles are refused', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const s = await steps(id);
    const router = by(s, 'Check router & connection');
    const wifi = by(s, 'Check Wi-Fi interference');
    const ok = await api().patch(`/api/steps/${wifi.id}`).set(bearer(sup)).send({ dependsOn: [router.id], version: wifi.version });
    expect(ok.status).toBe(200);
    expect(ok.body.step.status).toBe('LOCKED'); // now sequential
    const cur = await steps(id);
    const bad = await api().patch(`/api/steps/${router.id}`).set(bearer(sup)).send({ dependsOn: [by(cur, 'Check Wi-Fi interference').id], version: by(cur, 'Check router & connection').version });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('DEPENDENCY_CYCLE');
  });
});

describe('technician day report', () => {
  it('lists exactly which work was done, when, estimated vs actual; technicians see only their own', async () => {
    const id = await createDiagnosedTicket(srv.app, op, seed.customer.id);
    await assignTo(id, seed.techs[1]!.id);
    const s = await steps(id);
    const t0 = new Date(Date.now() - 60_000);
    for (const t of ['Check router & connection', 'Check Wi-Fi interference']) {
      const st = by(s, t);
      await api().post(`/api/steps/${st.id}/start`).set(bearer(nusrat)).expect(200);
      await new Promise((r) => setTimeout(r, 250));
      await api().post(`/api/steps/${st.id}/complete`).set(bearer(nusrat)).send({ note: `${t} ok` }).expect(200);
    }
    const q = `from=${encodeURIComponent(t0.toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`;
    const rep = await api().get(`/api/reports/technicians/${seed.techs[1]!.id}/day?${q}`).set(bearer(sup));
    expect(rep.status).toBe(200);
    expect(rep.body.technician.name).toBe('Tech Nusrat');
    expect(rep.body.items).toHaveLength(2);
    expect(rep.body.items[0]).toMatchObject({ ticketNo: 'TX-1001', status: 'DONE', estimatedMinutes: expect.any(Number) });
    expect(rep.body.items[0].startedAt).toBeTruthy();
    expect(rep.body.items[0].completedAt).toBeTruthy();
    expect(rep.body.items[0].note).toContain('ok');
    expect(rep.body.summary).toMatchObject({ stepsCompleted: 2, ticketsWorked: 1, ticketsAssigned: 1 });
    expect(rep.body.summary.estimatedMinutes).toBe(35); // 20 + 15
    expect(rep.body.summary.actualMinutes).toBeGreaterThan(0);
    expect(rep.body.assignedTickets[0].ticketNo).toBe('TX-1001');

    // a step still running shows up as IN_PROGRESS
    await api().post(`/api/steps/${by(s, 'Apply configuration fix').id}/start`).set(bearer(nusrat)).expect(200);
    const live = await api().get(`/api/reports/technicians/${seed.techs[1]!.id}/day?${q}`).set(bearer(nusrat)); // technician views own
    expect(live.status).toBe(200);
    expect(live.body.summary.stepsInProgress).toBe(1);

    // privacy / RBAC
    expect((await api().get(`/api/reports/technicians/${seed.techs[1]!.id}/day?${q}`).set(bearer(rafi))).status).toBe(403);
    expect((await api().get(`/api/reports/technicians/${seed.techs[1]!.id}/day?${q}`).set(bearer(op))).status).toBe(403);
    expect((await api().get(`/api/reports/technicians/${seed.techs[1]!.id}/day?from=${encodeURIComponent(new Date().toISOString())}&to=2020-01-01`).set(bearer(sup))).status).toBe(400);

    const team = await api().get(`/api/reports/technicians/day?${q}`).set(bearer(sup));
    expect(team.body.rows).toHaveLength(3);
    expect(team.body.rows.find((r: any) => r.name === 'Tech Nusrat').stepsCompleted).toBe(2);
    expect(team.body.rows.find((r: any) => r.name === 'Tech Rafi').stepsCompleted).toBe(0);
    expect((await api().get(`/api/reports/technicians/day?${q}`).set(bearer(nusrat))).status).toBe(403);
  });

  it('dashboard throughput: tickets created per hour', async () => {
    await createDiagnosedTicket(srv.app, op, seed.customer.id);
    const r = await api().get('/api/reports/throughput?hours=6').set(bearer(sup));
    expect(r.body.buckets).toHaveLength(6);
    expect(r.body.buckets.reduce((n: number, b: any) => n + b.created, 0)).toBe(1);
    const m = (await api().get('/api/metrics').set(bearer(sup))).body;
    expect(m.tickets.createdLast24h).toBe(1);
  });
});
